"""Reverse-engineer the drawdown reduction: which component actually causes it?

The corrected strategy shows lower maximum drawdown than buy-and-hold while
also earning less. That pattern has two very different explanations and they
must be told apart before any claim is made:

  (a) TIMING SKILL -- the system is out of the market disproportionately
      during the bad days, so it avoids drawdown faster than it gives up
      return; or
  (b) DELEVERING -- the system is simply invested less of the time, so both
      drawdown and return shrink roughly in proportion, and an investor could
      reproduce the whole effect by holding cash.

The decisive test is the CONSTANT-EXPOSURE CONTROL. Take the strategy's own
average exposure, hold exactly that fraction of the asset every single day
with no timing whatsoever, and compare. If the strategy's drawdown is no
better than that control, the entire effect is (b) and there is no skill to
report.

Exposure in the shipped system is a product of three dampeners:

    exposure = PROFILE_MAX[profile] x conviction x vol_scale

where conviction ramps from 0 at buyScore 55 to 1 at 72, vol_scale is
clip(target_vol / realised_vol, 0.4, 1.0), and a `sell` verdict forces flat.
Each arm below removes one of them, so the contribution of each is measured
rather than assumed.

No language model is involved. This is the numerical plane only.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

import eval_recommendation as er  # noqa: E402

DATA = _HERE / "data" / "_universe"


# --------------------------------------------------------------------------
# Ablation arms. Each replaces _target_exposure with a variant.
# --------------------------------------------------------------------------

# Captured at import, before any monkeypatching. arm_full must call THIS,
# not er._target_exposure -- the latter is rebound during the run, so calling
# it recurses into whichever arm is currently installed.
_ORIGINAL_TARGET_EXPOSURE = er._target_exposure


def _conviction(rec) -> float:
    bs = float(rec.get("buyScore") or 50.0)
    return float(np.clip((bs - er.SIZE_SCORE_LO) /
                         (er.SIZE_SCORE_HI - er.SIZE_SCORE_LO), 0.0, 1.0))


def arm_full(rec, profile, closes, params):
    """Shipped system, unchanged."""
    return _ORIGINAL_TARGET_EXPOSURE(rec, profile, closes, params)


def arm_no_sizing(rec, profile, closes, params):
    """Experiment 1: remove position sizing. In or out, nothing between."""
    if rec.get("action") == "sell":
        return 0.0
    return 1.0 if _conviction(rec) > 0.0 else 0.0


def arm_fixed_10(rec, profile, closes, params):
    """Experiment 2: remove confidence. Every held position is 10%."""
    if rec.get("action") == "sell":
        return 0.0
    return 0.10 if _conviction(rec) > 0.0 else 0.0


def arm_no_vol_target(rec, profile, closes, params):
    """Isolate the volatility dampener by removing only it."""
    if rec.get("action") == "sell":
        return 0.0
    c = _conviction(rec)
    if c <= 0.0:
        return 0.0
    return float(np.clip(er.PROFILE_MAX_EXPOSURE.get(profile, 0.85) * c, 0.0, 1.0))


def arm_always_in(rec, profile, closes, params):
    """Experiment 4: no risk manager, no filtering. Always fully invested.

    Should reproduce buy-and-hold to within transaction costs. It is included
    as a control on the harness itself: if this arm does NOT match B&H, the
    measurement is wrong and nothing else in the table can be trusted.
    """
    return 1.0


ARMS = {
    "full (shipped)": arm_full,
    "1: no position sizing (0 or 100%)": arm_no_sizing,
    "2: no confidence (fixed 10%)": arm_fixed_10,
    "3: no vol targeting": arm_no_vol_target,
    "4: always invested (harness control)": arm_always_in,
}


def stats(r: np.ndarray, rf: float) -> dict:
    r = np.asarray(r, dtype=float)
    if r.size == 0:
        return {"sharpe": 0.0, "ann": 0.0, "dd": 0.0}
    eq = np.cumprod(1.0 + r)
    peak = np.maximum.accumulate(eq)
    yrs = r.size / 252.0
    ex = r - rf / 252.0
    sd = ex.std()
    return {"sharpe": float(np.sqrt(252) * ex.mean() / sd) if sd > 1e-12 else 0.0,
            "ann": float((eq[-1] ** (1 / yrs) - 1) * 100) if yrs > 0 else 0.0,
            "dd": float(((eq - peak) / peak).min() * 100)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tickers", default="AAPL,MSFT,AMZN,TSLA,NVDA,JPM,XOM,PG,JNJ,CAT")
    ap.add_argument("--profile", default="high")
    ap.add_argument("--rf", type=float, default=0.04)
    ap.add_argument("--tune-frac", type=float, default=0.5)
    a = ap.parse_args()

    syms = [s.strip().upper() for s in a.tickers.split(",") if s.strip()]
    params = er.StrategyParams(execution_lag_days=1, risk_free_annual=a.rf)
    from models.market_forecaster import MarketForecaster
    forecaster = MarketForecaster()

    print(f"Drawdown ablation | {len(syms)} tickers | 10y | profile={a.profile} "
          f"| rf={a.rf:.0%} | lag=1\n")

    original = _ORIGINAL_TARGET_EXPOSURE
    acc: dict[str, dict[str, list]] = {k: {"s": [], "b": [], "exp": []} for k in ARMS}
    matched: dict[str, list] = {"s": [], "b": []}

    for sym in syms:
        cp = DATA / f"{sym}_10y.csv"
        if not cp.exists():
            print(f"  {sym}: no cached data, skipped")
            continue
        df = pd.read_csv(cp)
        closes = df["Close"].astype(float).to_numpy()
        n = len(closes)
        if n < 400:
            continue
        min_start = min(260, max(120, n // 3))
        idxs = list(range(min_start, n, params.rebalance_days))
        preds = er.precompute_predictions(
            df, sym, forecaster, idxs,
            cache_key=f"{sym}_10y_r{params.rebalance_days}_s{min_start}")
        agents = {"risk_manager": er.RiskManagerAgent(),
                  "risk_reasoner": er.RiskReasoningAgent(),
                  "verifier": er.VerificationAgent(),
                  "crew": er.FinanceCrew()}

        print(f"  {sym}: ", end="", flush=True)
        for name, fn in ARMS.items():
            try:
                er._target_exposure = fn
                rec = er.run_strategy(df, sym, preds, a.profile, params,
                                      min_start, agents, False)
                segs = er.evaluate_segments(rec, closes, a.tune_frac,
                                            risk_free_annual=a.rf)
                ser = (segs.get("holdout") or {}).get("series") or {}
                s = np.asarray(ser.get("strategy", []), dtype=float)
                b = np.asarray(ser.get("buyhold", []), dtype=float)
                if s.size and b.size:
                    m = min(s.size, b.size)
                    acc[name]["s"].append(s[:m])
                    acc[name]["b"].append(b[:m])
                    # Average exposure over the holdout, for the matched control.
                    exp = np.asarray(rec["exposures"], dtype=float)
                    cut = exp.size - m
                    acc[name]["exp"].append(float(np.mean(exp[cut:])) if cut >= 0
                                            else float(np.mean(exp)))
            finally:
                er._target_exposure = original

        # Constant-exposure control, matched to the SHIPPED arm's average
        # exposure. No timing at all -- just that fraction held every day.
        if acc["full (shipped)"]["s"]:
            s_full = acc["full (shipped)"]["s"][-1]
            b_full = acc["full (shipped)"]["b"][-1]
            k = acc["full (shipped)"]["exp"][-1]
            rf_d = a.rf / 252.0
            matched["s"].append(k * b_full + (1.0 - k) * rf_d)
            matched["b"].append(b_full)
        print("done")

    if not acc["full (shipped)"]["s"]:
        print("\nNo results.")
        return 1

    print(f"\n{'arm':<38}{'avg exp':>9}{'Sharpe':>9}{'AnnRet%':>10}{'MaxDD%':>10}")
    print("-" * 78)
    rows = {}
    for name in ARMS:
        if not acc[name]["s"]:
            continue
        s = np.concatenate(acc[name]["s"])
        st = stats(s, a.rf)
        e = float(np.mean(acc[name]["exp"])) if acc[name]["exp"] else float("nan")
        rows[name] = {**st, "exp": e}
        print(f"{name:<38}{e:>9.2f}{st['sharpe']:>9.3f}{st['ann']:>10.2f}{st['dd']:>10.1f}")

    bh = stats(np.concatenate(acc["full (shipped)"]["b"]), a.rf)
    print(f"{'buy & hold':<38}{1.00:>9.2f}{bh['sharpe']:>9.3f}"
          f"{bh['ann']:>10.2f}{bh['dd']:>10.1f}")

    mt = stats(np.concatenate(matched["s"]), a.rf)
    k = rows["full (shipped)"]["exp"]
    print(f"{'CONTROL: constant ' + f'{k:.0%}' + ' exposure':<38}{k:>9.2f}"
          f"{mt['sharpe']:>9.3f}{mt['ann']:>10.2f}{mt['dd']:>10.1f}")
    print("-" * 78)

    full = rows["full (shipped)"]
    print("\n--- WHERE DOES THE LOW DRAWDOWN COME FROM? ---")
    print(f"  shipped system max drawdown      : {full['dd']:>7.1f}%")
    print(f"  buy & hold                       : {bh['dd']:>7.1f}%")
    print(f"  constant {k:.0%} exposure, no timing : {mt['dd']:>7.1f}%")
    # Drawdowns are NEGATIVE. A deeper drawdown is a MORE negative number, so
    # "strategy minus control" is positive when the strategy is WORSE. Getting
    # this backwards reported a loss as a win twice before it was caught.
    edge = full["dd"] - mt["dd"]      # >0 => strategy drawdown is SHALLOWER (better)
    print(f"\n  timing edge over pure delevering : {edge:>+7.1f} pp")
    if edge > 1.0:
        print("  -> the strategy's drawdown is SHALLOWER than simply holding that")
        print("     fraction in cash. Some genuine timing is present.")
    elif edge < -1.0:
        print("  -> the strategy's drawdown is DEEPER than just holding that")
        print("     fraction in cash. The timing actively hurts; the apparent")
        print("     improvement over buy-and-hold is delevering alone.")
    else:
        print("  -> indistinguishable from simply holding that fraction in cash.")
        print("     The drawdown reduction is DELEVERING, not skill. An investor")
        print("     reproduces it with a cash allocation and no model at all.")

    out = _HERE / "results" / "ablate_drawdown.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(
        {"arms": rows, "buyhold": bh, "matched_control": mt,
         "avg_exposure": k, "timing_edge_pp": edge,
         "tickers": syms, "profile": a.profile, "rf": a.rf}, indent=2))
    print(f"\nwrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
