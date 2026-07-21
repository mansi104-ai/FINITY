"""
ablation.py -- does the multi-agent machinery do anything a moving average doesn't?

THE QUESTION
  FINDEC's buy score is a weighted blend. With sentiment unavailable in backtest
  (historical news isn't reproducible), the live weights are:

      TREND_WEIGHT_POINTS      = 80.0     <- price vs its own 30-day mean
      PREDICTION_WEIGHT_POINTS = 22.0     <- the Ridge+classifier Analyst

  So ~78% of the decision is a 30-day moving-average rule -- i.e. Brock,
  Lakonishok & LeBaron (1992) and Moskowitz, Ooi & Pedersen (2012), not a
  contribution of this system. Any reviewer will ask what the Planner,
  Researcher, Analyst, Risk Manager, Risk Reasoning and Verification agents add
  over that one line of arithmetic. This script answers it.

CELLS
  full            both sub-scores at their tuned weights (the shipped system)
  trend_only      prediction weight 0 -- the moving average alone
  prediction_only trend weight 0 -- the ML forecaster alone
  equal_weight    both at 50/50, to test whether the tuned ratio matters

REFERENCE STRATEGIES (not ablations -- external baselines)
  buyhold, sma_20_50, tsmom_12_1 (time-series momentum, Moskowitz et al.)

Every cell is compared with the stationary-bootstrap CI from significance.py, so
"cell A beats cell B" is only ever reported with an interval and a p-value. Given
the power analysis (power_analysis.py: ~6% power to detect a +0.30 Sharpe
difference at this sample size), the expected and honest outcome is that NO cell
separates from any other. Demonstrating that cleanly is the point.

    python ablation.py
    python ablation.py --n-boot 5000
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass

import numpy as np

import backtest_lib as bt
# eval_recommendation must be imported BEFORE crew: it performs the sys.path
# setup that makes the python_agents modules importable (see _locate_and_add).
import eval_recommendation as er
import significance as sig
import crew

TRADING_DAYS = 252


# --- Ablation cells: (name, trend_weight, prediction_weight, description) -----
CELLS = [
    ("full",            80.0, 22.0, "shipped system: trend + Analyst prediction"),
    ("trend_only",      80.0,  0.0, "30-day moving average alone (no ML)"),
    ("prediction_only",  0.0, 22.0, "Ridge+classifier Analyst alone (no trend)"),
    ("equal_weight",    51.0, 51.0, "both signals weighted equally"),
]


@dataclass
class CellResult:
    name: str
    description: str
    sharpe: float
    ann_return: float
    max_dd: float
    avg_exposure: float
    returns: np.ndarray


def _tsmom_curve(closes: np.ndarray, lookback: int = 252, skip: int = 21,
                 risk_free_annual: float = 0.0):
    """Time-series momentum (Moskowitz-Ooi-Pedersen 2012), long-only 12-1 variant.

    Long when the return over the past `lookback` days excluding the most recent
    `skip` days is positive, flat otherwise. Signal at day i is applied to the
    return from i to i+1 -- no lookahead, matching sma_crossover_curve.
    """
    n = closes.size
    if n < lookback + skip + 2:
        return np.zeros(max(n - 1, 0)), np.zeros(max(n - 1, 0)), 0
    daily = np.diff(closes) / closes[:-1]
    exposures = np.zeros(n - 1)
    trades, prev = 0, 0.0
    for i in range(lookback + skip, n - 1):
        past = closes[i - skip]
        older = closes[i - skip - lookback]
        signal = 1.0 if past > older else 0.0
        if signal != prev:
            trades += 1
        exposures[i] = signal
        prev = signal
    rets = daily * exposures + (risk_free_annual / TRADING_DAYS) * (1.0 - exposures)
    return rets, exposures, trades


def run_cell(name: str, trend_w: float, pred_w: float, description: str,
             tickers: list[str], period: str, profile: str, params: er.StrategyParams,
             tune_frac: float) -> CellResult:
    """Run one ablation cell across all tickers, returning the concatenated
    holdout return series plus summary metrics.

    Weights live as module-level constants in crew.py read at call time, so they
    are set here and restored by the caller (same mechanism tune_strategy.py uses).
    """
    old_t, old_p = crew.TREND_WEIGHT_POINTS, crew.PREDICTION_WEIGHT_POINTS
    crew.TREND_WEIGHT_POINTS = trend_w
    crew.PREDICTION_WEIGHT_POINTS = pred_w
    try:
        per_ticker = []
        for t in tickers:
            rep = er.run_ticker(t, period, [profile], params, tune_frac, False)
            per_ticker.append(rep["results"][profile]["holdout"]["series"]["strategy"])
        cat = np.concatenate(per_ticker)
        equity = np.concatenate([[1.0], np.cumprod(1.0 + cat)])
        return CellResult(
            name=name, description=description,
            sharpe=bt.sharpe_ratio(cat, params.risk_free_annual),
            ann_return=bt.annualized_return_pct(cat),
            max_dd=bt.max_drawdown_pct(equity),
            avg_exposure=float("nan"),
            returns=cat,
        )
    finally:
        crew.TREND_WEIGHT_POINTS = old_t
        crew.PREDICTION_WEIGHT_POINTS = old_p


def run_reference(tickers: list[str], period: str, profile: str,
                  params: er.StrategyParams, tune_frac: float) -> dict[str, CellResult]:
    """Buy&hold, SMA(20/50) and TSMOM(12-1) over the identical holdout windows."""
    from data_fetch import fetch_history

    acc = {"buyhold": [], "sma_20_50": [], "tsmom_12_1": []}
    for t in tickers:
        rep = er.run_ticker(t, period, [profile], params, tune_frac, False)
        s = rep["results"][profile]["holdout"]["series"]
        acc["buyhold"].append(s["buyhold"])
        acc["sma_20_50"].append(s["sma"])

        # TSMOM needs a long warm-up, so compute it on the full series then slice
        # to the identical holdout day window.
        hist = fetch_history(t, period)
        closes = hist["Close"].astype(float).to_numpy()
        n_hold = len(s["strategy"])
        ts, _, _ = _tsmom_curve(closes, risk_free_annual=params.risk_free_annual)
        acc["tsmom_12_1"].append(ts[-n_hold:] if ts.size >= n_hold else np.zeros(n_hold))

    out = {}
    labels = {"buyhold": "buy & hold (fully invested)",
              "sma_20_50": "SMA(20/50) crossover",
              "tsmom_12_1": "time-series momentum 12-1 (Moskowitz et al. 2012)"}
    for k, series_list in acc.items():
        cat = np.concatenate(series_list)
        equity = np.concatenate([[1.0], np.cumprod(1.0 + cat)])
        out[k] = CellResult(k, labels[k], bt.sharpe_ratio(cat, params.risk_free_annual),
                            bt.annualized_return_pct(cat), bt.max_drawdown_pct(equity),
                            float("nan"), cat)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Ablation study for the FINDEC decision layer.")
    ap.add_argument("--tickers", nargs="+", default=["AAPL", "MSFT", "AMZN", "TSLA", "NVDA"])
    ap.add_argument("--period", default="3y")
    ap.add_argument("--profile", default="high")
    ap.add_argument("--tune-frac", type=float, default=0.6)
    ap.add_argument("--risk-free", type=float, default=0.04)
    ap.add_argument("--n-boot", type=int, default=2000)
    args = ap.parse_args()

    params = er.StrategyParams(risk_free_annual=args.risk_free)

    print("=" * 82)
    print("FINDEC ABLATION -- what does the multi-agent stack add over a moving average?")
    print(f"holdout only | lag={params.execution_lag_days} | rf={args.risk_free:.1%} | "
          f"{len(args.tickers)} tickers")
    print("=" * 82)

    cells: dict[str, CellResult] = {}
    for name, tw, pw, desc in CELLS:
        cells[name] = run_cell(name, tw, pw, desc, args.tickers, args.period,
                               args.profile, params, args.tune_frac)
    refs = run_reference(args.tickers, args.period, args.profile, params, args.tune_frac)

    print(f"\n{'cell':<18s} {'Sharpe':>8s} {'AnnRet%':>9s} {'MaxDD%':>9s}   description")
    print("-" * 82)
    for name, _, _, _ in CELLS:
        c = cells[name]
        print(f"{c.name:<18s} {c.sharpe:>8.3f} {c.ann_return:>9.2f} {c.max_dd:>9.2f}   {c.description}")
    print("-" * 82)
    for k in ("buyhold", "sma_20_50", "tsmom_12_1"):
        c = refs[k]
        print(f"{c.name:<18s} {c.sharpe:>8.3f} {c.ann_return:>9.2f} {c.max_dd:>9.2f}   {c.description}")

    # --- The decisive comparisons, each with a CI ---------------------------
    print("\n" + "=" * 82)
    print("PAIRWISE TESTS (stationary bootstrap, 95% CI on the Sharpe difference)")
    print("=" * 82)

    comparisons = [
        ("full", "trend_only", cells["full"].returns, cells["trend_only"].returns,
         "Does the ML Analyst add anything to the moving average?"),
        ("full", "prediction_only", cells["full"].returns, cells["prediction_only"].returns,
         "Does the moving average add anything to the ML Analyst?"),
        ("full", "equal_weight", cells["full"].returns, cells["equal_weight"].returns,
         "Does the tuned 80/22 weight ratio matter?"),
        ("trend_only", "sma_20_50", cells["trend_only"].returns, refs["sma_20_50"].returns,
         "Is FINDEC's trend rule better than a textbook SMA crossover?"),
        ("full", "tsmom_12_1", cells["full"].returns, refs["tsmom_12_1"].returns,
         "Is the whole system better than published time-series momentum?"),
        ("full", "buyhold", cells["full"].returns, refs["buyhold"].returns,
         "Is the whole system better than doing nothing?"),
    ]

    n_significant = 0
    for a_name, b_name, a, b, question in comparisons:
        n = min(a.size, b.size)
        res = sig.bootstrap_metric_diff(a[:n], b[:n], "sharpe", args.risk_free,
                                        n_boot=args.n_boot)
        verdict = "SIGNIFICANT" if res.significant else "not significant"
        if res.significant:
            n_significant += 1
        print(f"\n  {question}")
        print(f"    {a_name} vs {b_name}: diff={res.difference:+.3f}  "
              f"95% CI [{res.ci_low:+.3f}, {res.ci_high:+.3f}]  p={res.p_value:.3f}  -> {verdict}")

    print("\n" + "=" * 82)
    print("VERDICT")
    print("=" * 82)
    print(f"  significant pairwise differences: {n_significant}/{len(comparisons)}")
    if n_significant == 0:
        print("""
  No component of the multi-agent pipeline is distinguishable from any other,
  nor from a textbook moving-average rule, nor from buy & hold, at this sample
  size. This is consistent with power_analysis.py: with ~2000 pooled holdout
  days and a strategy/benchmark correlation near 0.55, the test has roughly 6%
  power to detect even a large (+0.30) true Sharpe difference.

  The correct conclusion is NOT "the agents don't work". It is that this
  experiment cannot tell the difference either way, and neither can any
  published experiment of comparable size. Claims of component-level
  contribution in this literature are typically unfalsifiable at the sample
  sizes reported.""")
    else:
        print("  Some differences separated -- verify against the SPA-corrected p-value")
        print("  in significance.py before treating any of them as a finding.")


if __name__ == "__main__":
    main()
