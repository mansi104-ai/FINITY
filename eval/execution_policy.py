"""Can execution policy add value when the forecast has none?

`analyst_skill.py` established that the Analyst carries no positive
information at 1, 5 or 21 days (information coefficient negative at all
three; directional accuracy significantly BELOW chance at h=1). That result
kills every execution rule that conditions on the forecast -- conviction
ramps, confidence thresholds, forecast-driven adaptive sizing -- because
there is nothing in the signal to condition on.

But one execution rule does not use the forecast at all.

**Volatility targeting** sets exposure from *realised* volatility:
scale up when the asset is calm, down when it is turbulent. It needs no
prediction of direction, only an estimate of dispersion, and dispersion is
genuinely forecastable -- volatility clusters, which is among the most robust
facts in empirical finance. Moreira & Muir (2017) report that
volatility-managed portfolios improve Sharpe ratios across many asset
classes.

So the honest question for Direction B is not "how do we size our
predictions?" but:

    does execution policy add value when the signal it would otherwise
    condition on is worthless?

Arms
----
  buy_hold        exposure 1.0 always
  constant_k      exposure k always, k matched to another arm's average.
                  No timing whatsoever -- the delevering control.
  vol_target      exposure = clip(target_vol / realised_vol, 0, cap).
                  Uses NO forecast. This is the arm under test.
  vol_target_lag  same, but the volatility estimate is lagged one extra day,
                  to confirm the effect is not an artefact of using same-day
                  information.

Every arm is computed on the same days from the same closes, with the same
one-day execution lag and the same risk-free accrual on uninvested capital,
so differences are attributable to the sizing rule alone.

No forecaster and no language model are involved.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

DATA = _HERE / "data" / "_universe"
TRADING_DAYS = 252


def metrics(r: np.ndarray, rf: float) -> dict:
    r = np.asarray(r, dtype=float)
    if r.size == 0:
        return {"sharpe": 0.0, "ann": 0.0, "dd": 0.0, "vol": 0.0}
    eq = np.cumprod(1.0 + r)
    peak = np.maximum.accumulate(eq)
    yrs = r.size / TRADING_DAYS
    ex = r - rf / TRADING_DAYS
    sd = ex.std()
    return {"sharpe": float(np.sqrt(TRADING_DAYS) * ex.mean() / sd) if sd > 1e-12 else 0.0,
            "ann": float((eq[-1] ** (1 / yrs) - 1) * 100) if yrs > 0 else 0.0,
            "dd": float(((eq - peak) / peak).min() * 100),
            "vol": float(r.std() * np.sqrt(TRADING_DAYS) * 100)}


def realised_vol(rets: np.ndarray, window: int = 20) -> np.ndarray:
    """Trailing volatility, strictly backward-looking.

    Element t is computed from returns[t-window:t] -- it excludes day t, so an
    exposure set from it and applied to day t's return uses no same-day
    information.
    """
    n = rets.size
    out = np.full(n, np.nan)
    for t in range(window, n):
        out[t] = rets[t - window:t].std()
    return out


def simulate(rets: np.ndarray, exposure: np.ndarray, rf: float,
             cost_bps: float = 5.0) -> np.ndarray:
    """Book returns on a given exposure path, with turnover cost and cash yield.

    `exposure[t]` must already be lagged so it is knowable before day t.
    """
    rf_d = rf / TRADING_DAYS
    prev = np.concatenate([[0.0], exposure[:-1]])
    turnover = np.abs(exposure - prev)
    cost = turnover * cost_bps / 10_000.0
    return exposure * rets + (1.0 - exposure) * rf_d - cost


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rf", type=float, default=0.04)
    ap.add_argument("--target-vol", type=float, default=0.15,
                    help="annualised volatility target for the vol-targeting arm")
    ap.add_argument("--cap", type=float, default=1.0,
                    help="maximum exposure; >1 permits leverage")
    ap.add_argument("--window", type=int, default=20)
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()

    files = sorted(DATA.glob("*_10y.csv"))
    if a.limit:
        files = files[:a.limit]
    if not files:
        print("no cached price data")
        return 1

    tv_daily = a.target_vol / math.sqrt(TRADING_DAYS)
    acc: dict[str, list] = {k: [] for k in
                            ("buy_hold", "constant_k", "vol_target", "vol_target_lag")}
    exposures = []

    for f in files:
        closes = pd.read_csv(f)["Close"].astype(float).to_numpy()
        if closes.size < 400:
            continue
        rets = np.diff(closes) / closes[:-1]

        rv = realised_vol(rets, a.window)
        valid = ~np.isnan(rv)
        if valid.sum() < 200:
            continue
        r = rets[valid]
        v = rv[valid]

        # Exposure from trailing vol, then lagged one further day so it is
        # unambiguously knowable before the return it earns.
        e_vt = np.clip(tv_daily / np.maximum(v, 1e-8), 0.0, a.cap)
        e_vt_lag = np.concatenate([[e_vt[0]], e_vt[:-1]])

        k = float(np.mean(e_vt_lag))
        exposures.append(k)

        acc["buy_hold"].append(simulate(r, np.ones_like(r), a.rf))
        acc["constant_k"].append(simulate(r, np.full_like(r, k), a.rf))
        acc["vol_target"].append(simulate(r, e_vt, a.rf))
        acc["vol_target_lag"].append(simulate(r, e_vt_lag, a.rf))

    n_t = len(exposures)
    if not n_t:
        print("nothing evaluated")
        return 1

    print(f"Execution-policy comparison | {n_t} tickers | 10y | "
          f"target vol {a.target_vol:.0%} | cap {a.cap:.2f} | rf {a.rf:.0%}")
    print("No forecaster is used. Sizing depends only on realised volatility.\n")
    print(f"mean exposure of the vol-targeting arm: {np.mean(exposures):.3f}\n")

    # Per-ticker metrics then averaged. Concatenating tickers into one
    # pseudo-timeline would fabricate drawdowns across ticker boundaries.
    rows = {}
    print(f"{'arm':<24}{'Sharpe':>9}{'AnnRet%':>10}{'MaxDD%':>10}{'Vol%':>9}")
    print("-" * 62)
    for name, series in acc.items():
        ms = [metrics(x, a.rf) for x in series]
        rows[name] = {k: float(np.mean([m[k] for m in ms])) for k in
                      ("sharpe", "ann", "dd", "vol")}
        rows[name]["per_ticker_sharpe"] = [m["sharpe"] for m in ms]
        r_ = rows[name]
        print(f"{name:<24}{r_['sharpe']:>9.3f}{r_['ann']:>10.2f}"
              f"{r_['dd']:>10.1f}{r_['vol']:>9.1f}")
    print("-" * 62)

    vt = rows["vol_target_lag"]
    ck = rows["constant_k"]
    bh = rows["buy_hold"]

    print("\n--- DOES VOLATILITY TARGETING ADD VALUE? ---")
    print("Compared against a constant exposure at the SAME average level,")
    print("which isolates the timing from the delevering.\n")
    d_sh = vt["sharpe"] - ck["sharpe"]
    d_dd = vt["dd"] - ck["dd"]
    print(f"  Sharpe   vol-target {vt['sharpe']:+.3f} vs constant {ck['sharpe']:+.3f}"
          f"   -> {d_sh:+.3f}")
    print(f"  MaxDD    vol-target {vt['dd']:+.1f}% vs constant {ck['dd']:+.1f}%"
          f"   -> {d_dd:+.1f} pp ({'better' if d_dd > 0 else 'worse'})")

    # Paired test across tickers: same names, two policies.
    from scipy import stats as ss
    x = np.array(vt["per_ticker_sharpe"])
    y = np.array(ck["per_ticker_sharpe"])
    t, p = ss.ttest_rel(x, y)
    w = int(np.sum(x > y))
    print(f"\n  paired t-test across {n_t} tickers: t={t:+.2f}  p={p:.4f}")
    print(f"  vol-targeting wins on {w}/{n_t} tickers")
    if p < 0.05 and t > 0:
        print("\n  => Volatility targeting improves risk-adjusted return over a")
        print("     constant exposure, WITHOUT any forecast. Execution policy")
        print("     adds value where prediction does not.")
    elif p < 0.05 and t < 0:
        print("\n  => Volatility targeting is significantly WORSE than a constant.")
    else:
        print("\n  => No significant difference from a constant exposure.")

    print(f"\n  (reference) buy & hold: Sharpe {bh['sharpe']:+.3f}, "
          f"AnnRet {bh['ann']:.2f}%, MaxDD {bh['dd']:.1f}%")

    out = _HERE / "results" / "execution_policy.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(
        {"n_tickers": n_t, "target_vol": a.target_vol, "cap": a.cap,
         "mean_exposure": float(np.mean(exposures)),
         "arms": {k: {kk: vv for kk, vv in r_.items()
                      if kk != "per_ticker_sharpe"} for k, r_ in rows.items()},
         "paired_t": float(t), "paired_p": float(p), "wins": w}, indent=2))
    print(f"\nwrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
