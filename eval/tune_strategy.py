"""
tune_strategy.py

Out-of-sample parameter search for the FINDEC decision/timing overlay.

Discipline: predictions are computed once per ticker (the expensive walk-forward,
shared across the whole grid). Each parameter combo is scored ONLY on the earlier
TUNE segment; the single winning combo is then reported on the untouched HOLDOUT
segment. This is what keeps "better than the baselines" an honest, out-of-sample
claim rather than a curve-fit to the test period.

The swept parameters are the real decision knobs -- some live in
orchestrator/crew.py (module-level, read at call time, so we set them at runtime),
some in eval_recommendation.py (exposure ramp). Nothing here fabricates data or
changes the model; it only chooses how the overlay weights trend vs prediction and
how aggressively it sizes.

USAGE
    python tune_strategy.py                         # 5 bundled tickers, profile=high
    python tune_strategy.py --profile medium --rebalance-days 10
"""

from __future__ import annotations

import argparse
import itertools
import pickle
import time
from pathlib import Path

import numpy as np

PRED_CACHE_DIR = Path(__file__).parent / ".pred_cache"
PRED_CACHE_DIR.mkdir(exist_ok=True)


def _cached_predictions(ticker, period, rebalance_days, history, min_start, idxs, forecaster):
    """Disk-cache the expensive per-rebalance forecaster predictions so repeated
    sweeps/tuning runs don't re-pay the multi-minute walk-forward. Keyed by the
    inputs that determine the predictions (ticker/period/rebalance cadence)."""
    key = PRED_CACHE_DIR / f"{ticker}_{period}_r{rebalance_days}_s{min_start}.pkl"
    if key.exists():
        with open(key, "rb") as f:
            return pickle.load(f)
    import eval_recommendation as _er
    preds = _er.precompute_predictions(history, ticker, forecaster, idxs)
    with open(key, "wb") as f:
        pickle.dump(preds, f)
    return preds

import backtest_lib as bt
import eval_recommendation as er
import crew
from data_fetch import fetch_history
from market_forecaster import MarketForecaster
from risk_manager import RiskManagerAgent
from risk_reasoning import RiskReasoningAgent
from verification import VerificationAgent
from crew import FinanceCrew

# Grid over the decision knobs. Kept modest so the search stays interpretable and
# the risk of overfitting a large grid to the tune segment stays low.
GRID = {
    "trend_weight": [34.0, 55.0, 80.0],       # crew.TREND_WEIGHT_POINTS
    "prediction_weight": [22.0, 30.0],        # crew.PREDICTION_WEIGHT_POINTS
    "size_hi": [66.0, 72.0],                  # er.SIZE_SCORE_HI (lower => fuller exposure sooner)
    "target_daily_vol": [0.015, 0.025],       # StrategyParams.target_daily_vol (higher => less haircut)
}


def _apply(combo: dict) -> None:
    crew.TREND_WEIGHT_POINTS = combo["trend_weight"]
    crew.PREDICTION_WEIGHT_POINTS = combo["prediction_weight"]
    er.SIZE_SCORE_HI = combo["size_hi"]


def _beats_both(strat, bh) -> bool:
    return strat.annualized_return_pct > bh.annualized_return_pct and strat.sharpe > bh.sharpe


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tickers", nargs="+", default=["AAPL", "MSFT", "AMZN", "TSLA", "NVDA"])
    parser.add_argument("--period", default="3y")
    parser.add_argument("--profile", default="high")
    parser.add_argument("--rebalance-days", type=int, default=10)
    parser.add_argument("--tune-frac", type=float, default=0.6)
    args = parser.parse_args()

    params = er.StrategyParams(rebalance_days=args.rebalance_days)
    agents = {
        "risk_manager": RiskManagerAgent(),
        "risk_reasoner": RiskReasoningAgent(),
        "verifier": VerificationAgent(),
        "crew": FinanceCrew(),
    }
    forecaster = MarketForecaster()

    # --- Precompute predictions once per ticker (the expensive part) ---
    store = {}
    t0 = time.time()
    for ticker in args.tickers:
        history = fetch_history(ticker, args.period)
        closes = history["Close"].astype(float).to_numpy()
        n = len(closes)
        min_start = min(260, max(120, n // 3))
        idxs = list(range(min_start, n, args.rebalance_days))
        preds = _cached_predictions(ticker, args.period, args.rebalance_days, history, min_start, idxs, forecaster)
        store[ticker] = {"history": history, "closes": closes, "min_start": min_start, "preds": preds}
        print(f"  loaded {ticker}: {len(preds)} predictions")
    print(f"Prediction precompute done in {time.time() - t0:.0f}s. Sweeping {np.prod([len(v) for v in GRID.values()])} combos on TUNE...\n")

    # --- Sweep on the TUNE segment ---
    keys = list(GRID.keys())
    results = []
    for values in itertools.product(*[GRID[k] for k in keys]):
        combo = dict(zip(keys, values))
        _apply(combo)
        p = er.StrategyParams(rebalance_days=args.rebalance_days, target_daily_vol=combo["target_daily_vol"])
        beat_both = 0
        sharpe_margin = []
        ret_margin = []
        for ticker, d in store.items():
            records = er.run_strategy(d["history"], ticker, d["preds"], args.profile, p, d["min_start"], agents)
            segs = er.evaluate_segments(records, d["closes"], args.tune_frac)
            strat, bh = segs["tune"]["strategy"], segs["tune"]["buyhold"]
            if _beats_both(strat, bh):
                beat_both += 1
            sharpe_margin.append(strat.sharpe - bh.sharpe)
            ret_margin.append(strat.annualized_return_pct - bh.annualized_return_pct)
        results.append({
            "combo": combo,
            "beat_both": beat_both,
            "mean_sharpe_margin": float(np.mean(sharpe_margin)),
            "mean_ret_margin": float(np.mean(ret_margin)),
        })

    # Objective: maximize #tickers beating buy&hold on BOTH metrics (tune),
    # tie-broken by mean Sharpe margin then mean return margin.
    results.sort(key=lambda r: (r["beat_both"], r["mean_sharpe_margin"], r["mean_ret_margin"]), reverse=True)
    print("Top 5 combos by TUNE objective (beat-both, then sharpe margin):")
    for r in results[:5]:
        print(f"  beat_both={r['beat_both']}/{len(args.tickers)}  d_sharpe={r['mean_sharpe_margin']:+.2f}  "
              f"d_ret={r['mean_ret_margin']:+.1f}%  {r['combo']}")

    best = results[0]["combo"]
    print(f"\n>>> WINNER (chosen on TUNE only): {best}\n")

    # --- Report the winner on HOLDOUT (untouched) across all profiles ---
    _apply(best)
    p = er.StrategyParams(rebalance_days=args.rebalance_days, target_daily_vol=best["target_daily_vol"])
    print("===== HOLDOUT (out-of-sample) with tune-optimal params =====")
    hold_beats = {prof: 0 for prof in ("low", "medium", "high")}
    for ticker, d in store.items():
        print(f"\n  {ticker}")
        for prof in ("low", "medium", "high"):
            records = er.run_strategy(d["history"], ticker, d["preds"], prof, p, d["min_start"], agents)
            segs = er.evaluate_segments(records, d["closes"], args.tune_frac)
            strat = segs["holdout"]["strategy"]
            bh = segs["holdout"]["buyhold"]
            if prof == "low":
                print(f"    {'Buy&Hold':14s} {bh.one_line()}")
                print(f"    {'SMA(20/50)':14s} {segs['holdout']['sma'].one_line()}")
            flag = "  <-- beats B&H (both)" if _beats_both(strat, bh) else ""
            if _beats_both(strat, bh):
                hold_beats[prof] += 1
            print(f"    {'FINDEC:' + prof:14s} {strat.one_line()}{flag}")
    print("\n  Holdout beat-both tally:", {k: f"{v}/{len(args.tickers)}" for k, v in hold_beats.items()})


if __name__ == "__main__":
    main()
