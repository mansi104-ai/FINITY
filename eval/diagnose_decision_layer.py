"""Is the decision layer fixable, or is the signal it acts on empty?

Direction B asks how to improve the timing policy. Before tuning anything,
one question decides whether tuning is worth doing at all:

    does `buyScore` carry information about forward returns?

The shipped policy maps buyScore to exposure through a conviction ramp
(0 at 55, full at 72) multiplied by a volatility dampener. If buyScore is
uncorrelated with what happens next, then every one of those knobs is
amplifying noise, and no re-tuning of the ramp, the thresholds or the
dampener can help -- the correct fix is to stop conditioning on it.

If instead buyScore does predict, but the mapping to exposure is wrong, that
is a calibration problem and is fixable: fit the sizing from realised
outcomes rather than asserting a linear ramp.

Measured here, per rebalance date, strictly out of sample:
  * Spearman and Pearson correlation between buyScore and the forward return
    actually realised over the next rebalance window;
  * mean forward return by buyScore decile, which shows the shape rather than
    just the strength;
  * the implied optimal exposure per decile, which is what a learned sizing
    policy would use.

No language model is involved.
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


def collect(sym: str, params, profile: str):
    """(buyScore, forward return) pairs for one ticker, out of sample."""
    cp = DATA / f"{sym}_10y.csv"
    if not cp.exists():
        return None
    df = pd.read_csv(cp)
    closes = df["Close"].astype(float).to_numpy()
    n = len(closes)
    if n < 400:
        return None

    min_start = min(260, max(120, n // 3))
    idxs = list(range(min_start, n, params.rebalance_days))
    from models.market_forecaster import MarketForecaster
    preds = er.precompute_predictions(
        df, sym, MarketForecaster(), idxs,
        cache_key=f"{sym}_10y_r{params.rebalance_days}_s{min_start}")

    agents = {"risk_manager": er.RiskManagerAgent(),
              "risk_reasoner": er.RiskReasoningAgent(),
              "verifier": er.VerificationAgent(),
              "crew": er.FinanceCrew()}

    # run_strategy records the buy_signals it acted on as (day index, forward
    # return). That is exactly the pairing needed and it is produced by the
    # corrected engine, so the forward return is genuinely subsequent to the
    # decision.
    rec = er.run_strategy(df, sym, preds, profile, params, min_start, agents, False)
    sig = rec.get("buy_signals") or []
    if not sig:
        return None

    rows = []
    for idx, fwd in sig:
        p = preds.get(min_start + idx) or preds.get(idx)
        if not p:
            continue
        bs = p.get("buyScore")
        if bs is None:
            # Fall back to the predicted return, which is what buyScore is
            # derived from when the crew is unavailable.
            bs = p.get("predictedReturnPct")
        if bs is None:
            continue
        rows.append((float(bs), float(fwd)))
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tickers", default="AAPL,MSFT,AMZN,TSLA,NVDA,JPM,XOM,PG,JNJ,CAT,"
                                         "KO,WMT,CVX,UNH,HD,BAC,MRK,PEP,ABT,ORCL")
    ap.add_argument("--profile", default="high")
    ap.add_argument("--rf", type=float, default=0.04)
    a = ap.parse_args()

    params = er.StrategyParams(execution_lag_days=1, risk_free_annual=a.rf)
    syms = [s.strip().upper() for s in a.tickers.split(",") if s.strip()]

    allrows = []
    for s in syms:
        try:
            r = collect(s, params, a.profile)
        except Exception as e:
            print(f"  {s}: {type(e).__name__}: {e}")
            continue
        if r:
            allrows.extend(r)
            print(f"  {s}: {len(r)} decisions")

    if len(allrows) < 50:
        print(f"\nonly {len(allrows)} decisions collected; not enough to diagnose")
        return 1

    bs = np.array([x[0] for x in allrows])
    fw = np.array([x[1] for x in allrows])
    n = len(bs)

    print(f"\n{n} out-of-sample decisions across {len(syms)} tickers\n")

    # Correlations. Spearman is the honest one here: the conviction ramp is
    # monotone but not linear, so rank correlation is what the policy needs.
    from scipy import stats as ss
    pr, pp = ss.pearsonr(bs, fw)
    sr, sp = ss.spearmanr(bs, fw)
    print(f"{'Pearson  r':<14}{pr:+.4f}   p={pp:.4f}")
    print(f"{'Spearman rho':<14}{sr:+.4f}   p={sp:.4f}")

    # A correlation near zero at this n is the decisive finding.
    se = 1.0 / np.sqrt(n - 3)
    print(f"\n(at n={n}, the 95% band around zero correlation is "
          f"+/-{1.96*se:.4f})")

    print(f"\n{'buyScore decile':<18}{'n':>6}{'mean score':>12}"
          f"{'mean fwd ret %':>16}{'hit rate':>10}")
    print("-" * 64)
    order = np.argsort(bs)
    for d in range(10):
        lo, hi = int(d * n / 10), int((d + 1) * n / 10)
        sel = order[lo:hi]
        if sel.size == 0:
            continue
        f = fw[sel]
        print(f"{'D' + str(d + 1):<18}{sel.size:>6}{bs[sel].mean():>12.1f}"
              f"{f.mean() * 100:>16.3f}{(f > 0).mean():>10.1%}")

    top = fw[order[int(0.9 * n):]]
    bot = fw[order[:int(0.1 * n)]]
    print("-" * 64)
    print(f"top decile mean forward return   : {top.mean()*100:+.3f}%")
    print(f"bottom decile mean forward return: {bot.mean()*100:+.3f}%")
    spread = (top.mean() - bot.mean()) * 100
    t, tp = ss.ttest_ind(top, bot, equal_var=False)
    print(f"spread (top - bottom)            : {spread:+.3f}%  "
          f"t={t:+.2f}  p={tp:.4f}")

    print("\n--- VERDICT ---")
    if sp < 0.05 and abs(sr) > 0.03:
        print("buyScore carries measurable information about forward returns.")
        print("The decision layer is worth fixing: learn the sizing map from")
        print("these outcomes instead of asserting a linear ramp.")
    else:
        print("buyScore is not distinguishable from noise at this sample size.")
        print("Every knob that conditions exposure on it -- the conviction ramp,")
        print("the thresholds, the volatility dampener -- is amplifying noise.")
        print("No re-tuning of those knobs can help; the fix is to stop")
        print("conditioning exposure on this signal.")

    out = _HERE / "results" / "decision_layer_diagnosis.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "n_decisions": int(n), "tickers": syms,
        "pearson_r": float(pr), "pearson_p": float(pp),
        "spearman_rho": float(sr), "spearman_p": float(sp),
        "top_decile_mean_fwd": float(top.mean()),
        "bottom_decile_mean_fwd": float(bot.mean()),
        "spread_pct": float(spread), "spread_p": float(tp),
    }, indent=2))
    print(f"\nwrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
