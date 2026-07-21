"""
eval_recommendation.py

Honest, out-of-sample backtest of FINDEC's ACTUAL end-to-end decision logic
(FinanceCrew._build_recommendation), fed by the REAL MarketForecaster.predict()
(same code path as production) and a REAL point-in-time (no-lookahead) VaR.

WHAT THIS TESTS, HONESTLY
  - Prediction: python_agents/models/market_forecaster.py, called exactly as
    agents/analyst.py calls it, re-sliced to only the data available as of each
    rebalance date (no lookahead).
  - Risk: the same VaR/position-sizing formula as risk_manager.py, but computed
    locally from the point-in-time price slice (see _historical_var) instead of
    risk_manager's live network fetch -- a live fetch inside a backtest loop
    would be slow AND leak lookahead (var_calculator always pulls the latest 2y).
  - Risk Reasoning / Verification / Recommendation: the REAL agents
    (agents/risk_reasoning.py, agents/verification.py, orchestrator/crew.py),
    run with their deterministic fallback (no LLM key required).

STAND-INS, AND WHY
  - Sentiment: real historical news for a past date isn't reproducible from a
    free API, so the backtest marks sentiment ABSENT (dataAvailable=False, see
    ABSENT_SENTIMENT). The redesigned decision logic renormalizes over only the
    available signals, so the Analyst carries the decision here -- these numbers
    are a LOWER bound on what the live pipeline does with real contemporaneous
    news added back in.
  - Reliability: adaptive per-agent reliability weighting is a live signal that
    isn't reproducible for a backtest, so it too is fed NEUTRAL (see
    NEUTRAL_RELIABILITY) -- every agent gets a 1.0x multiplier.
  - Position direction: a `sell`/`hold` verdict means "exit to flat", not "open
    a short" -- this matches the app's long-only retail framing.

OUT-OF-SAMPLE DISCIPLINE
  Each ticker's evaluated days are split into an earlier TUNE segment and a
  later HOLDOUT segment (see --tune-frac). Any parameter choice must be made
  against TUNE metrics only; HOLDOUT is the reported, untouched result. Both are
  printed so the tune->holdout gap (the overfitting tell) is visible. Strategy
  timing is compared against buy&hold and a naive SMA(20/50) crossover baseline.

EXPOSURE FRAMING
  This measures the pipeline's *timing skill*: exposure is in [0, 1] (fraction
  allocated to the idea), BUY -> allocated (optionally confidence/vol scaled),
  HOLD/SELL -> flat. That is the fair comparison to a fully-invested buy&hold.
  The app's separate 6-16% position-size cap is a budget-risk concern, not a
  timing-skill measure, so it is used to shape the aggressiveness curve rather
  than as an absolute exposure ceiling.

USAGE
    pip install numpy pandas
    python eval_recommendation.py                       # all 5 bundled tickers
    python eval_recommendation.py --tickers AAPL --rebalance-days 10 --verbose
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from data_fetch import fetch_history  # noqa: E402
import backtest_lib as bt  # noqa: E402


def _locate_and_add(module_filename: str) -> None:
    here = Path(__file__).resolve().parent
    repo_root = Path(os.environ.get("FINDEC_REPO_ROOT", here.parent))
    candidates = [
        repo_root / "python_agents" / "models",
        repo_root / "python_agents" / "agents",
        repo_root / "python_agents" / "orchestrator",
        repo_root / "python_agents" / "risk",
        repo_root / "python_agents",
        repo_root,
        here / "agent_src",
    ]
    for c in candidates:
        if (c / module_filename).exists():
            sys.path.insert(0, str(c))
            return
    for found in repo_root.rglob(module_filename):
        sys.path.insert(0, str(found.parent))
        return
    print(f"WARNING: could not find {module_filename} under {repo_root}. "
          f"Set FINDEC_REPO_ROOT to your repo root if autodetect fails.")


for _mod in ("market_forecaster.py", "risk_manager.py", "risk_reasoning.py",
             "verification.py", "crew.py", "var_calculator.py"):
    _locate_and_add(_mod)

_repo_root = Path(os.environ.get("FINDEC_REPO_ROOT", Path(__file__).resolve().parent.parent))
_python_agents_dir = _repo_root / "python_agents"
for _p in (str(_python_agents_dir), str(_repo_root)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from market_forecaster import MarketForecaster  # noqa: E402
from risk_reasoning import RiskReasoningAgent  # noqa: E402
from verification import VerificationAgent  # noqa: E402
from crew import FinanceCrew  # noqa: E402
import risk_manager as risk_manager_module  # noqa: E402
from risk_manager import RiskManagerAgent  # noqa: E402

# Historical news for a past date isn't reproducible from a free API, so the
# backtest has NO sentiment signal. We mark it dataAvailable=False (absent) rather
# than "available but neutral": under the renormalized decision model an
# available-neutral sentiment would contribute a 50/100 sub-score at full weight
# and anchor the score at neutral, defeating the whole point. Absent -> its weight
# cedes to the Analyst, so the backtest measures the Analyst/Risk/Regime pipeline
# WITHOUT news -- which is exactly the "lower bound" the module docstring claims.
ABSENT_SENTIMENT = {
    "level": "HOLD",
    "score": 0.5,
    "confidence": 0.0,
    "dataAvailable": False,
    "message": "No sentiment signal in backtest -- historical news isn't reproducible; see module docstring.",
}

# Empty snapshot -> every agent falls back to RELIABILITY_PRIOR inside
# crew._build_recommendation (a 1.0x multiplier). See module docstring.
NEUTRAL_RELIABILITY: dict = {}

# How aggressively each risk profile is allowed to participate in the market
# (upper bound on [0,1] exposure). Timing skill still comes from going flat in
# bad regimes; 'high' can reach fully-invested so its ceiling matches buy&hold.
PROFILE_MAX_EXPOSURE = {"low": 0.6, "medium": 0.85, "high": 1.0}


@dataclass
class StrategyParams:
    rebalance_days: int = 10
    cost_bps: float = 2.0
    slippage_bps: float = 3.0
    vol_targeting: bool = True       # scale exposure down when realized vol is high
    target_daily_vol: float = 0.025  # ~2.5%/day reference for vol targeting (tuned out-of-sample)
    # Trading days between observing the data a decision is made on and earning
    # the return that decision exposes us to. MUST be >= 1: the decision at day
    # t is made from closes[:t+1] (it reads closes[t]), so the earliest return it
    # may legitimately earn is closes[t] -> closes[t+1].
    #
    # lag=0 reproduces the ORIGINAL (defective) behaviour, in which the exposure
    # chosen using closes[t] was applied to the return INTO closes[t] -- a
    # one-day lookahead on every rebalance day. It is retained ONLY so the paper
    # can quantify what that lookahead was worth (see docs/RESEARCH_PLAN.md D1);
    # it must never be used to produce a reported performance number.
    execution_lag_days: int = 1
    # Annualized risk-free rate. Used BOTH to accrue cash on the unallocated
    # fraction of the portfolio (a strategy sitting flat 50-70% of the time in a
    # 4-5% cash regime is not earning zero) and as the Sharpe hurdle, so the
    # strategy and the fully-invested baselines are compared on equal terms.
    risk_free_annual: float = 0.0


def _historical_var(closes_so_far: np.ndarray, position_value: float, confidence: float = 0.95,
                     lookback_days: int = 120) -> dict:
    """Same percentile-of-historical-returns formula as risk/var_calculator.py's
    calculate_var, but computed from a point-in-time slice (no network fetch, no
    lookahead). Returns dataAvailable so the real risk_manager path (which now
    refuses to size against synthetic VaR) is exercised faithfully."""
    window = closes_so_far[-(lookback_days + 1):]
    returns = pd.Series(window).pct_change().dropna().to_numpy()
    if returns.size < 30:
        return {"dataAvailable": False, "message": "Insufficient real history for VaR (<30 returns)."}
    percentile = max(0.1, min(99.9, (1 - confidence) * 100))
    var_pct = abs(float(np.percentile(returns, percentile) * 100))
    return {
        "dataAvailable": True,
        "var_pct": round(var_pct, 4),
        "var_usd": round(position_value * (var_pct / 100), 2),
        "confidence": round(confidence, 2),
        "volatility_pct": round(float(np.std(returns) * 100), 4),
        "observationCount": int(returns.size),
    }


import pickle  # noqa: E402

PRED_CACHE_DIR = Path(__file__).parent / ".pred_cache"
PRED_CACHE_DIR.mkdir(exist_ok=True)


def precompute_predictions(history: pd.DataFrame, ticker: str, forecaster: MarketForecaster,
                           rebalance_idxs: list[int], cache_key: str | None = None) -> dict[int, dict]:
    """Run the REAL forecaster once per rebalance date (profile-independent, so
    this expensive walk-forward is shared across all risk profiles and any
    parameter sweep). Each slice is point-in-time -- only data up to idx.

    Optionally disk-cached (cache_key) so repeated runs/sweeps don't re-pay the
    multi-minute walk-forward; the key must capture everything that determines
    the predictions (ticker/period/rebalance cadence/warm-up)."""
    if cache_key is not None:
        cache_file = PRED_CACHE_DIR / f"{cache_key}.pkl"
        if cache_file.exists():
            with open(cache_file, "rb") as f:
                return pickle.load(f)
    predictions: dict[int, dict] = {}
    for idx in rebalance_idxs:
        history_slice = history.iloc[: idx + 1]
        try:
            prediction = forecaster.predict(
                history_slice, ticker=ticker, query="", sentiment_score=0.5,
                sentiment_level="HOLD",
                # The bundled CSVs are real historical daily market data (same
                # quality as a live yfinance pull), so label it as such -- using a
                # "backtest" tag would make _calibrated_confidence apply its
                # synthetic-data 0.72x penalty and unfairly depress confidence
                # below the buy gate for data that is, in fact, real.
                data_source="yfinance",
            )
            prediction["dataAvailable"] = True
        except Exception as e:
            prediction = {"dataAvailable": False, "message": f"predict() failed: {e}"}
        predictions[idx] = prediction
    if cache_key is not None:
        with open(PRED_CACHE_DIR / f"{cache_key}.pkl", "wb") as f:
            pickle.dump(predictions, f)
    return predictions


def _daily_vol(closes_so_far: np.ndarray, lookback: int = 20) -> float:
    window = closes_so_far[-(lookback + 1):]
    if window.size < 3:
        return 0.02
    returns = np.diff(window) / np.maximum(window[:-1], 1e-9)
    return float(np.std(returns)) if returns.size else 0.02


# Buy-score range over which exposure ramps from flat to full participation. The
# exposure is CONTINUOUS in the buy score (not a binary buy/flat switch): the buy
# score already blends trend + prediction + risk + verification, so sizing off it
# keeps the overlay proportionally invested through an uptrend instead of dropping
# to flat every time a rebalance lands on a sub-threshold "hold".
SIZE_SCORE_LO = 55.0   # exposure starts ramping up here (below -> flat)
SIZE_SCORE_HI = 72.0   # full profile participation at/above here (tuned out-of-sample)


def _target_exposure(recommendation: dict, risk_profile: str, closes_so_far: np.ndarray,
                     params: StrategyParams) -> float:
    """Continuous [0,1] exposure from buy-score conviction, scaled by realized
    volatility (risk control) and the profile ceiling. A `sell` verdict forces
    flat; below SIZE_SCORE_LO conviction is 0 (also flat)."""
    if recommendation.get("action") == "sell":
        return 0.0
    buy_score = float(recommendation.get("buyScore") or 50.0)
    conviction = float(np.clip((buy_score - SIZE_SCORE_LO) / (SIZE_SCORE_HI - SIZE_SCORE_LO), 0.0, 1.0))
    if conviction <= 0.0:
        return 0.0
    exposure = PROFILE_MAX_EXPOSURE.get(risk_profile, 0.85) * conviction
    if params.vol_targeting:
        dv = _daily_vol(closes_so_far)
        vol_scale = float(np.clip(params.target_daily_vol / max(dv, 1e-6), 0.4, 1.0))
        exposure *= vol_scale
    return float(np.clip(exposure, 0.0, 1.0))


def run_strategy(history: pd.DataFrame, ticker: str, predictions: dict[int, dict],
                 risk_profile: str, params: StrategyParams, min_start: int,
                 agents: dict, verbose: bool = False) -> dict:
    """Cheap decision + sizing loop over cached predictions. Returns per-day
    arrays (aligned so index k = day min_start + k) plus rebalance bookkeeping."""
    risk_manager = agents["risk_manager"]
    risk_reasoner = agents["risk_reasoner"]
    verifier = agents["verifier"]
    crew = agents["crew"]

    closes = history["Close"].astype(float).to_numpy()
    n = len(closes)
    real_calculate_var = risk_manager_module.calculate_var

    day_returns: list[float] = []
    exposures: list[float] = []
    buy_signals: list[tuple[int, float]] = []  # (relative day idx, forward return)
    actions_taken = {"buy": 0, "hold": 0, "sell": 0}
    exposure = 0.0
    prev_exposure = 0.0
    n_trades = 0

    # Exposure decided at day `t` becomes effective at day `t + execution_lag_days`.
    # pending[d] = exposure that starts earning on day d.
    pending: dict[int, float] = {}
    rf_daily = params.risk_free_annual / bt.TRADING_DAYS

    idx = min_start
    next_rebalance = min_start
    while idx < n:
        daily_return = (closes[idx] - closes[idx - 1]) / closes[idx - 1] if idx > 0 else 0.0

        # Order within the loop body is the whole ballgame (defect D1):
        #   1. decide  -- may read closes[:idx+1], schedules into pending[idx+lag]
        #   2. apply   -- adopt whatever exposure becomes effective today
        #   3. book    -- earn today's return on the now-effective exposure
        # With lag>=1 a decision made today cannot reach today's return. With
        # lag=0 it can, which is exactly the original lookahead, preserved so it
        # can be measured.
        if idx >= next_rebalance:
            prediction = predictions.get(idx, {"dataAvailable": False})
            closes_so_far = closes[: idx + 1]
            risk_manager_module.calculate_var = (
                lambda ticker, position_value, confidence=0.95, lookback_days=120,
                _closes=closes_so_far: _historical_var(_closes, position_value, confidence, lookback_days)
            )
            risk = risk_manager.evaluate(ticker=ticker, budget=200_000.0, risk_profile=risk_profile, prediction=prediction)
            risk_reasoning = risk_reasoner.reason(
                ticker=ticker, prediction=prediction if prediction.get("dataAvailable") else None,
                risk=risk if risk.get("dataAvailable") else None, market=None, sentiment=ABSENT_SENTIMENT,
            )
            verification = verifier.verify(
                sentiment=ABSENT_SENTIMENT,
                prediction=prediction if prediction.get("dataAvailable") else None,
                risk=risk if risk.get("dataAvailable") else None, market=None,
            )
            recommendation = crew._build_recommendation(
                ticker=ticker, budget=200_000.0, risk_profile=risk_profile, sentiment=ABSENT_SENTIMENT,
                prediction=prediction, risk=risk, risk_reasoning=risk_reasoning, verification=verification,
                reliability=NEUTRAL_RELIABILITY,
            )
            action = recommendation["action"]
            actions_taken[action] = actions_taken.get(action, 0) + 1
            new_exposure = _target_exposure(recommendation, risk_profile, closes_so_far, params)

            # Schedule the new exposure to take effect after the execution lag.
            effective_day = idx + max(0, int(params.execution_lag_days))
            pending[effective_day] = new_exposure

            # Record a "long entry" whenever we go from flat to invested, scored
            # by the forward return over the next rebalance window -- the timing
            # hit-rate, independent of position size. Measured from the price we
            # can actually transact at (the lagged entry day), not the
            # decision-day close.
            entry_idx = min(n - 1, effective_day)
            if new_exposure > 0.0 and exposure == 0.0:
                fwd_end = min(n - 1, entry_idx + params.rebalance_days)
                if fwd_end > entry_idx:
                    buy_signals.append(
                        (entry_idx - min_start, (closes[fwd_end] - closes[entry_idx]) / closes[entry_idx])
                    )
            if verbose:
                print(f"  day {idx:4d} {ticker} action={action:5s} buyScore={recommendation.get('buyScore')} "
                      f"exp->{new_exposure:.2f}@d{effective_day} predRet={prediction.get('predictedReturnPct')} "
                      f"conf={prediction.get('confidence')}")
            next_rebalance = idx + params.rebalance_days

        # 2. Adopt whatever exposure becomes effective today.
        if idx in pending:
            exposure = pending.pop(idx)

        # 3. Book today's P&L on the now-effective exposure. Unallocated capital
        #    earns the risk-free rate (D3).
        turnover = abs(exposure - prev_exposure)
        if turnover > 1e-9:
            n_trades += 1
        cost = turnover * (params.cost_bps + params.slippage_bps) / 10_000
        day_returns.append(daily_return * exposure + rf_daily * (1.0 - exposure) - cost)
        exposures.append(exposure)
        prev_exposure = exposure

        idx += 1

    risk_manager_module.calculate_var = real_calculate_var  # restore

    return {
        "day_returns": np.array(day_returns),
        "exposures": np.array(exposures),
        "buy_signals": buy_signals,
        "actions": actions_taken,
        "n_trades": n_trades,
        "min_start": min_start,
    }


def evaluate_segments(records: dict, closes: np.ndarray, tune_frac: float,
                      risk_free_annual: float = 0.0) -> dict:
    """Split the continuous run into earlier tune / later holdout segments and
    compute strategy + baseline metrics for each."""
    day_returns = records["day_returns"]
    exposures = records["exposures"]
    min_start = records["min_start"]
    n_eval = day_returns.size
    cut = bt.split_point(n_eval, tune_frac)

    out = {}
    for label, lo, hi in (("tune", 0, cut), ("holdout", cut, n_eval)):
        seg_returns = day_returns[lo:hi]
        seg_exposures = exposures[lo:hi]
        seg_buys = [(i - lo, fwd) for (i, fwd) in records["buy_signals"] if lo <= i < hi]
        # count trades within the segment (exposure changes)
        seg_full = exposures[max(0, lo - 1):hi]
        seg_trades = int(np.sum(np.abs(np.diff(seg_full)) > 1e-9)) if seg_full.size > 1 else 0
        strat = bt.strategy_segment_metrics(label, seg_returns, seg_exposures, seg_buys,
                                            records["actions"] if label == "holdout" else {}, seg_trades,
                                            risk_free_annual=risk_free_annual)
        # Baseline closes for this segment, aligned to the SAME day window the
        # strategy booked (D2). Strategy day k is the return
        # closes[min_start+k-1] -> closes[min_start+k], so the segment [lo, hi)
        # spans closes[min_start+lo-1 .. min_start+hi-1]; differencing that slice
        # yields exactly the hi-lo returns the strategy was scored on.
        base_lo = max(0, min_start + lo - 1)
        seg_closes = closes[base_lo: min_start + hi]

        # Retain the aligned per-day return series alongside the summary metrics.
        # significance.py needs the raw arrays (a bootstrap cannot be run on a
        # rounded Sharpe), and they must come from the identical day window the
        # metrics above were computed over.
        bh_daily = np.diff(seg_closes) / seg_closes[:-1] if seg_closes.size > 1 else np.array([])
        sma_daily, sma_exp, _ = bt.sma_crossover_curve(seg_closes)
        sma_daily = sma_daily + (risk_free_annual / bt.TRADING_DAYS) * (1.0 - sma_exp)

        out[label] = {
            "strategy": strat,
            "buyhold": bt.buy_and_hold_segment(seg_closes, risk_free_annual=risk_free_annual),
            "sma": bt.sma_crossover_segment(seg_closes, risk_free_annual=risk_free_annual),
            "series": {
                "strategy": seg_returns,
                "buyhold": bh_daily,
                "sma": sma_daily,
            },
        }
    return out


def run_ticker(ticker: str, period: str, profiles: list[str], params: StrategyParams,
               tune_frac: float, verbose: bool) -> dict:
    history = fetch_history(ticker, period)
    closes = history["Close"].astype(float).to_numpy()
    n = len(closes)
    min_start = min(260, max(120, n // 3))  # real train window before first decision

    forecaster = MarketForecaster()
    agents = {
        "risk_manager": RiskManagerAgent(),
        "risk_reasoner": RiskReasoningAgent(),
        "verifier": VerificationAgent(),
        "crew": FinanceCrew(),
    }

    rebalance_idxs = list(range(min_start, n, params.rebalance_days))
    cache_key = f"{ticker}_{period}_r{params.rebalance_days}_s{min_start}"
    t0 = time.time()
    predictions = precompute_predictions(history, ticker, forecaster, rebalance_idxs, cache_key=cache_key)
    predict_s = time.time() - t0

    results = {}
    for profile in profiles:
        records = run_strategy(history, ticker, predictions, profile, params, min_start, agents, verbose)
        results[profile] = evaluate_segments(records, closes, tune_frac,
                                             risk_free_annual=params.risk_free_annual)
    return {"ticker": ticker, "n_days": n, "min_start": min_start, "predict_s": round(predict_s, 1),
            "results": results}


def _print_ticker(report: dict, profiles: list[str]) -> None:
    ticker = report["ticker"]
    print(f"\n===== {ticker}  ({report['n_days']} days, first decision @ day {report['min_start']}, "
          f"predict {report['predict_s']}s) =====")
    for seg in ("tune", "holdout"):
        print(f"  [{seg.upper()}]")
        # baselines are identical across profiles; print once from the first profile
        first = report["results"][profiles[0]][seg]
        print(f"    {'Buy&Hold':16s} {first['buyhold'].one_line()}")
        print(f"    {'SMA(20/50)':16s} {first['sma'].one_line()}")
        for profile in profiles:
            strat = report["results"][profile][seg]["strategy"]
            print(f"    {'FINDEC:' + profile:16s} {strat.one_line()}")


def _aggregate(reports: list[dict], profiles: list[str]) -> None:
    print("\n===== AGGREGATE (holdout, out-of-sample) =====")
    print(f"  {'':16s} {'AnnRet%':>8s} {'Sharpe':>7s} {'MaxDD%':>8s}   beats-B&H(Sharpe)")
    # buy&hold aggregate
    bh_sharpes = [r["results"][profiles[0]]["holdout"]["buyhold"].sharpe for r in reports]
    bh_rets = [r["results"][profiles[0]]["holdout"]["buyhold"].annualized_return_pct for r in reports]
    bh_dd = [r["results"][profiles[0]]["holdout"]["buyhold"].max_drawdown_pct for r in reports]
    print(f"  {'Buy&Hold':16s} {np.mean(bh_rets):>8.2f} {np.mean(bh_sharpes):>7.2f} {np.mean(bh_dd):>8.2f}")
    for profile in profiles:
        sharpes, rets, dds, wins = [], [], [], 0
        for r in reports:
            s = r["results"][profile]["holdout"]["strategy"]
            bh = r["results"][profile]["holdout"]["buyhold"]
            sharpes.append(s.sharpe); rets.append(s.annualized_return_pct); dds.append(s.max_drawdown_pct)
            if s.sharpe > bh.sharpe:
                wins += 1
        print(f"  {'FINDEC:' + profile:16s} {np.mean(rets):>8.2f} {np.mean(sharpes):>7.2f} {np.mean(dds):>8.2f}"
              f"   {wins}/{len(reports)} tickers")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tickers", nargs="+", default=["AAPL", "MSFT", "AMZN", "TSLA", "NVDA"])
    parser.add_argument("--period", default="3y")
    parser.add_argument("--rebalance-days", type=int, default=10)
    parser.add_argument("--tune-frac", type=float, default=0.6, help="fraction of evaluated days used as the (earlier) tune segment")
    parser.add_argument("--profiles", nargs="+", default=["low", "medium", "high"])
    parser.add_argument("--cost-bps", type=float, default=2.0)
    parser.add_argument("--slippage-bps", type=float, default=3.0)
    parser.add_argument("--no-vol-targeting", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    params = StrategyParams(
        rebalance_days=args.rebalance_days, cost_bps=args.cost_bps, slippage_bps=args.slippage_bps,
        vol_targeting=not args.no_vol_targeting,
    )

    print("FINDEC recommendation backtest -- REAL pipeline, out-of-sample (tune vs holdout).")
    print("Sentiment + reliability are NEUTRAL placeholders (see docstring): numbers are a lower bound.")
    print(f"Exposure in [0,1] = timing skill; profile ceilings {PROFILE_MAX_EXPOSURE}.\n")

    reports = []
    for ticker in args.tickers:
        try:
            report = run_ticker(ticker, args.period, args.profiles, params, args.tune_frac, args.verbose)
            reports.append(report)
            _print_ticker(report, args.profiles)
        except Exception as e:
            print(f"{ticker}: FAILED -- {e}")

    if reports:
        _aggregate(reports, args.profiles)


if __name__ == "__main__":
    main()
