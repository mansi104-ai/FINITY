"""
reliability_replay.py -- does adaptive agent-reliability weighting do anything?

THE DEFECT THIS CLOSES (docs/RESEARCH_PLAN.md, D4)
  Adaptive per-agent reliability weighting is FINDEC's stated novel contribution:
  each agent's influence on the buy score is scaled by a Bayesian-smoothed trust
  score built from its own measured track record (services/reliability.py).

  It was never evaluated. eval_recommendation.py hard-codes

      NEUTRAL_RELIABILITY: dict = {}

  which makes every agent fall back to RELIABILITY_PRIOR and receive a 1.0x
  multiplier. The mechanism contributed EXACTLY ZERO to every number the project
  has ever reported. A reviewer finds this in minutes.

WHAT THIS SCRIPT DOES
  Replays the backtest chronologically with a LIVE ReliabilityStore, so scores
  accumulate across rebalance dates exactly as they would in production: at each
  decision the store is read first (never self-referential), the recommendation
  is built with those weights, and only then is this request's outcome recorded.

  Two of the four scored agents produce a genuine quality signal in an offline
  backtest:
    - AnalystAgent    : walk-forward directional accuracy, measured fresh per
                        request -- a real number, and the most informative one.
    - RiskManagerAgent: whether VaR was computed from real history.
  The other two cannot be replayed offline and are recorded as unavailable:
    - ResearcherAgent : historical news is not reproducible (quality 0.0).
    - MarketAgent     : no live fetch in a backtest.
  This is a PARTIAL but honest replay, and it is stated as such rather than
  quietly filling the gaps.

  Cells: reliability OFF (the shipped baseline) vs ON (accumulating), compared
  with the stationary-bootstrap CI from significance.py.

    python reliability_replay.py
"""

from __future__ import annotations

import argparse
import tempfile
from pathlib import Path

import numpy as np

import backtest_lib as bt
import eval_recommendation as er
import significance as sig
from reliability import ReliabilityStore, blended_reliability, volatility_context  # noqa: E402


def _fresh_store() -> ReliabilityStore:
    """A ReliabilityStore backed by a throwaway file, so each replay starts from
    the prior with no leakage between cells or between runs."""
    tmp = Path(tempfile.mkdtemp(prefix="findec_rel_")) / "store.json"
    return ReliabilityStore(str(tmp))


def _record_outcomes(store: ReliabilityStore, context: str, prediction: dict, risk: dict) -> None:
    """Mirror of crew._record_reliability_outcomes for the two agents whose
    quality signal is reproducible offline. Kept deliberately identical in
    formula to the production code so the replay measures the shipped mechanism,
    not a re-invention of it."""
    # Analyst: walk-forward directional accuracy, as in crew.py.
    if prediction.get("dataAvailable", False):
        b = prediction.get("backtest") or {}
        acc = b.get("directionalAccuracyEnsemblePct", b.get("directionalAccuracyPct", 50.0))
        analyst_q = max(0.0, min(1.0, float(acc) / 100.0))
    else:
        analyst_q = 0.0
    for ctx in ("overall", context):
        store.record("AnalystAgent", ctx, analyst_q)

    # Risk Manager: rewards a VaR computed from real history, scaled by support.
    if risk.get("dataAvailable", False):
        obs = float(risk.get("observationCount", 0) or 0)
        risk_q = max(0.0, min(1.0, 0.5 + 0.5 * min(1.0, obs / 120.0)))
    else:
        risk_q = 0.0
    for ctx in ("overall", context):
        store.record("RiskManagerAgent", ctx, risk_q)

    # Researcher / Market: not reproducible offline -- recorded as unavailable
    # rather than skipped, so their reliability honestly decays toward 0 the way
    # it would for a production agent whose data source is persistently down.
    for agent in ("ResearcherAgent", "MarketAgent"):
        for ctx in ("overall", context):
            store.record(agent, ctx, 0.0)


def run_with_reliability(ticker: str, period: str, profile: str,
                         params: er.StrategyParams, tune_frac: float,
                         enabled: bool) -> tuple[np.ndarray, dict]:
    """Chronological replay of one ticker. Returns (holdout daily returns, final
    reliability snapshot)."""
    import risk_manager as risk_manager_module
    from data_fetch import fetch_history

    history = fetch_history(ticker, period)
    closes = history["Close"].astype(float).to_numpy()
    n = len(closes)
    min_start = min(260, max(120, n // 3))

    forecaster = er.MarketForecaster()
    risk_manager = er.RiskManagerAgent()
    risk_reasoner = er.RiskReasoningAgent()
    verifier = er.VerificationAgent()
    crew_obj = er.FinanceCrew()

    idxs = list(range(min_start, n, params.rebalance_days))
    preds = er.precompute_predictions(history, ticker, forecaster, idxs,
                                      cache_key=f"{ticker}_{period}_r{params.rebalance_days}_s{min_start}")

    store = _fresh_store() if enabled else None
    real_var = risk_manager_module.calculate_var

    day_returns, exposures = [], []
    pending: dict[int, float] = {}
    rf_daily = params.risk_free_annual / bt.TRADING_DAYS
    exposure = prev_exposure = 0.0
    idx, next_rebalance = min_start, min_start

    while idx < n:
        daily_return = (closes[idx] - closes[idx - 1]) / closes[idx - 1] if idx > 0 else 0.0

        if idx >= next_rebalance:
            prediction = preds.get(idx, {"dataAvailable": False})
            closes_so_far = closes[: idx + 1]
            risk_manager_module.calculate_var = (
                # NB: first parameter must be named `ticker` -- risk_manager.py
                # calls calculate_var(ticker=..., position_value=...) by keyword.
                lambda ticker, position_value, confidence=0.95, lookback_days=120,
                _c=closes_so_far: er._historical_var(_c, position_value, confidence, lookback_days))
            risk = risk_manager.evaluate(ticker=ticker, budget=200_000.0,
                                         risk_profile=profile, prediction=prediction)
            rr = risk_reasoner.reason(ticker=ticker,
                                      prediction=prediction if prediction.get("dataAvailable") else None,
                                      risk=risk if risk.get("dataAvailable") else None,
                                      market=None, sentiment=er.ABSENT_SENTIMENT)
            vf = verifier.verify(sentiment=er.ABSENT_SENTIMENT,
                                 prediction=prediction if prediction.get("dataAvailable") else None,
                                 risk=risk if risk.get("dataAvailable") else None, market=None)

            if store is not None:
                # Volatility regime for this decision, from the point-in-time slice.
                w = closes_so_far[-21:]
                vol_pct = float(np.std(np.diff(w) / w[:-1]) * 100) if w.size > 2 else None
                ctx = volatility_context(vol_pct)
                # READ before RECORD -- never self-referential.
                reliability = {a: blended_reliability(store, a, ctx)
                               for a in ("ResearcherAgent", "AnalystAgent",
                                         "RiskManagerAgent", "MarketAgent")}
            else:
                ctx, reliability = "unknown", er.NEUTRAL_RELIABILITY

            rec = crew_obj._build_recommendation(
                ticker=ticker, budget=200_000.0, risk_profile=profile,
                sentiment=er.ABSENT_SENTIMENT, prediction=prediction, risk=risk,
                risk_reasoning=rr, verification=vf, reliability=reliability)

            if store is not None:
                _record_outcomes(store, ctx, prediction, risk)

            pending[idx + max(0, int(params.execution_lag_days))] = \
                er._target_exposure(rec, profile, closes_so_far, params)
            next_rebalance = idx + params.rebalance_days

        if idx in pending:
            exposure = pending.pop(idx)
        turnover = abs(exposure - prev_exposure)
        cost = turnover * (params.cost_bps + params.slippage_bps) / 10_000
        day_returns.append(daily_return * exposure + rf_daily * (1.0 - exposure) - cost)
        exposures.append(exposure)
        prev_exposure = exposure
        idx += 1

    risk_manager_module.calculate_var = real_var

    arr = np.array(day_returns)
    cut = bt.split_point(arr.size, tune_frac)
    snapshot = {}
    if store is not None:
        snapshot = {a: blended_reliability(store, a, "overall")
                    for a in ("ResearcherAgent", "AnalystAgent", "RiskManagerAgent", "MarketAgent")}
    return arr[cut:], snapshot


def main() -> None:
    ap = argparse.ArgumentParser(description="Evaluate adaptive reliability weighting.")
    ap.add_argument("--tickers", nargs="+", default=["AAPL", "MSFT", "AMZN", "TSLA", "NVDA"])
    ap.add_argument("--period", default="3y")
    ap.add_argument("--profile", default="high")
    ap.add_argument("--tune-frac", type=float, default=0.6)
    ap.add_argument("--risk-free", type=float, default=0.04)
    ap.add_argument("--n-boot", type=int, default=2000)
    args = ap.parse_args()

    params = er.StrategyParams(risk_free_annual=args.risk_free)

    print("=" * 80)
    print("RELIABILITY WEIGHTING -- ON vs OFF (chronological replay, holdout only)")
    print("=" * 80)
    print("Partial replay: Analyst and RiskManager quality signals are reproducible")
    print("offline; Researcher and MarketAgent are recorded unavailable (see docstring).")

    results = {}
    snapshots = {}
    for enabled in (False, True):
        per_ticker = []
        for t in args.tickers:
            r, snap = run_with_reliability(t, args.period, args.profile, params,
                                           args.tune_frac, enabled)
            per_ticker.append(r)
            if enabled:
                snapshots[t] = snap
        results[enabled] = np.concatenate(per_ticker)

    off, on = results[False], results[True]
    print(f"\n{'cell':<22s} {'Sharpe':>8s} {'AnnRet%':>9s}")
    print("-" * 42)
    print(f"{'reliability OFF':<22s} {bt.sharpe_ratio(off, args.risk_free):>8.3f} "
          f"{bt.annualized_return_pct(off):>9.2f}")
    print(f"{'reliability ON':<22s} {bt.sharpe_ratio(on, args.risk_free):>8.3f} "
          f"{bt.annualized_return_pct(on):>9.2f}")

    n = min(off.size, on.size)
    res = sig.bootstrap_metric_diff(on[:n], off[:n], "sharpe", args.risk_free, n_boot=args.n_boot)
    print(f"\n  ON vs OFF: diff={res.difference:+.4f}  95% CI [{res.ci_low:+.4f}, {res.ci_high:+.4f}]  "
          f"p={res.p_value:.3f}  -> {'SIGNIFICANT' if res.significant else 'not significant'}")

    print("\n  Final reliability scores (overall bucket), first ticker:")
    first = args.tickers[0]
    for agent, v in snapshots.get(first, {}).items():
        score = v.get("score") if isinstance(v, dict) else v
        trials = v.get("trials") if isinstance(v, dict) else "?"
        print(f"    {agent:<20s} score={score}  trials={trials}")

    print("\n" + "=" * 80)
    print("VERDICT")
    print("=" * 80)
    if not res.significant:
        print("""  Adaptive reliability weighting produces NO detectable change in
  out-of-sample performance. Per docs/RESEARCH_PLAN.md item 4, the claim that it
  makes the system "adaptive rather than statically weighted" must therefore be
  removed from the paper's contribution list. The mechanism should be presented
  as a transparency/auditability feature -- which it genuinely is, since it
  exposes per-agent trust in the decision trace -- and NOT as a performance
  result.""")
    else:
        print("  A detectable difference. Re-check against the SPA-corrected p-value")
        print("  before claiming it, and confirm the sign is favourable.")


if __name__ == "__main__":
    main()
