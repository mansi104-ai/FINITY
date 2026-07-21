"""
test_no_lookahead.py -- regression tests that fail if lookahead is reintroduced.

The FINDEC backtest previously applied the exposure decided from closes[t] to the
return INTO closes[t] (docs/RESEARCH_PLAN.md, defect D1). That single-line
ordering bug moved holdout mean Sharpe from 0.28 to 0.72 and flipped the paper's
headline claim from "loses to buy&hold" to "beats buy&hold 4/5". It was invisible
to every existing check.

These tests make it impossible to reintroduce silently.

    pytest eval/test_no_lookahead.py -v
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

import backtest_lib as bt
import eval_recommendation as er


# --- The oracle: a strategy that can see today's return will ace this series ---

def _alternating_series(n: int = 600, step: float = 0.03) -> np.ndarray:
    """Deterministic zig-zag with zero drift. Buy&hold earns ~nothing, but any
    strategy that knows the sign of today's move before booking it earns a
    large, unmistakable positive return."""
    rng = np.random.default_rng(0)
    signs = np.where(np.arange(n) % 2 == 0, 1.0, -1.0)
    # tiny jitter so the series isn't perfectly periodic (which a trend signal
    # could exploit legitimately)
    rets = signs * step * (1.0 + rng.normal(0, 0.05, n))
    return 100.0 * np.cumprod(1.0 + rets)


class _OracleCrew:
    """Stands in for FinanceCrew._build_recommendation. Returns a maximally
    bullish score iff the NEXT close is higher -- i.e. it always wants to be
    long exactly when being long pays. Under correct execution timing its
    decision at day t is applied to t->t+1, so it *should* score well; the point
    of the test below is the reverse direction (see test_lag_zero_is_detectable).
    """

    def __init__(self, closes: np.ndarray):
        self.closes = closes

    def _build_recommendation(self, **kw):
        # `history` on the prediction carries closes up to and including the
        # decision day; its last element tells us which day we are on.
        hist = kw["prediction"].get("history") or []
        t = len(hist) - 1
        nxt = self.closes[t + 1] if t + 1 < len(self.closes) else self.closes[t]
        bullish = nxt > self.closes[t]
        return {"action": "buy" if bullish else "sell",
                "buyScore": 100.0 if bullish else 0.0}


class _SameDayOracleCrew(_OracleCrew):
    """Wants to be long iff TODAY's realized move was up. Under correct timing
    this is worthless (it reacts one day late). Under lookahead it is perfect."""

    def _build_recommendation(self, **kw):
        hist = kw["prediction"].get("history") or []
        t = len(hist) - 1
        up_today = t > 0 and self.closes[t] > self.closes[t - 1]
        return {"action": "buy" if up_today else "sell",
                "buyScore": 100.0 if up_today else 0.0}


def _run(closes: np.ndarray, crew, lag: int) -> float:
    """Run the real run_strategy loop against a stub crew. Returns annualized %."""
    history = pd.DataFrame({"Close": closes})
    n = len(closes)
    min_start = 60
    params = er.StrategyParams(rebalance_days=1, cost_bps=0.0, slippage_bps=0.0,
                               vol_targeting=False, execution_lag_days=lag,
                               risk_free_annual=0.0)
    # Predictions carry only what the stub crew needs: the point-in-time history.
    predictions = {i: {"dataAvailable": True, "history": list(closes[: i + 1]),
                       "predictedReturnPct": 0.0, "confidence": 0.9,
                       "backtest": {"directionalAccuracy": 60.0}}
                   for i in range(min_start, n)}

    class _NullAgent:
        def evaluate(self, **kw): return {"dataAvailable": False}
        def reason(self, **kw): return {}
        def verify(self, **kw): return {}

    agents = {"risk_manager": _NullAgent(), "risk_reasoner": _NullAgent(),
              "verifier": _NullAgent(), "crew": crew}
    rec = er.run_strategy(history, "TEST", predictions, "high", params, min_start, agents)
    return bt.annualized_return_pct(rec["day_returns"])


def test_default_execution_lag_is_one():
    """The default must be lag>=1. A default of 0 silently restores the bug."""
    assert er.StrategyParams().execution_lag_days >= 1


def test_same_day_signal_earns_nothing_under_correct_timing():
    """A strategy keyed on TODAY's realized move must NOT profit, because under
    correct timing it can only act tomorrow. If this starts passing money to the
    strategy, lookahead has been reintroduced."""
    closes = _alternating_series()
    ann = _run(closes, _SameDayOracleCrew(closes), lag=1)
    # On a mean-reverting zig-zag, reacting a day late is actively harmful; the
    # one thing it must never be is hugely profitable.
    assert ann < 20.0, (
        f"Same-day signal earned {ann:.1f}%/yr under lag=1 -- it should not be "
        f"able to profit from a move it only observes after the fact. "
        f"Lookahead has been reintroduced into run_strategy."
    )


def test_lag_zero_is_detectable_and_much_better():
    """Guard on the guard: confirm this harness can actually SEE lookahead.
    With lag=0 the same-day oracle should print an absurd return."""
    closes = _alternating_series()
    ann_bug = _run(closes, _SameDayOracleCrew(closes), lag=0)
    ann_fixed = _run(closes, _SameDayOracleCrew(closes), lag=1)
    assert ann_bug > ann_fixed + 50.0, (
        f"lag=0 ({ann_bug:.1f}%) should be dramatically better than lag=1 "
        f"({ann_fixed:.1f}%) on this series. If it isn't, this test can no "
        f"longer detect lookahead and the other tests are vacuous."
    )


def test_forward_looking_oracle_profits_under_correct_timing():
    """Sanity: a signal that genuinely predicts tomorrow SHOULD make money at
    lag=1. Ensures the lag fix didn't simply break the loop's ability to trade."""
    closes = _alternating_series()
    ann = _run(closes, _OracleCrew(closes), lag=1)
    assert ann > 50.0, (
        f"A true next-day oracle only earned {ann:.1f}%/yr at lag=1 -- the "
        f"execution-lag plumbing is dropping or misapplying exposures."
    )


# --- Benchmark alignment (D2) ------------------------------------------------

def test_buyhold_window_matches_strategy_window():
    """A fully-invested strategy must reproduce buy&hold exactly. This only holds
    if the benchmark is sliced over the identical day window (D2)."""
    closes = _alternating_series(300)

    class _AlwaysLong:
        def _build_recommendation(self, **kw):
            return {"action": "buy", "buyScore": 100.0}

    history = pd.DataFrame({"Close": closes})
    n, min_start = len(closes), 60
    params = er.StrategyParams(rebalance_days=1, cost_bps=0.0, slippage_bps=0.0,
                               vol_targeting=False, execution_lag_days=1)
    predictions = {i: {"dataAvailable": True, "history": list(closes[: i + 1]),
                       "predictedReturnPct": 0.0, "confidence": 0.9}
                   for i in range(min_start, n)}

    class _NullAgent:
        def evaluate(self, **kw): return {"dataAvailable": False}
        def reason(self, **kw): return {}
        def verify(self, **kw): return {}

    agents = {"risk_manager": _NullAgent(), "risk_reasoner": _NullAgent(),
              "verifier": _NullAgent(), "crew": _AlwaysLong()}
    rec = er.run_strategy(history, "TEST", predictions, "high", params, min_start, agents)
    segs = er.evaluate_segments(rec, closes, tune_frac=0.6)

    for label in ("tune", "holdout"):
        strat = segs[label]["strategy"]
        bh = segs[label]["buyhold"]
        assert strat.n_days == bh.n_days, (
            f"[{label}] strategy scored {strat.n_days} days but buy&hold scored "
            f"{bh.n_days} -- benchmark window is misaligned (D2)."
        )


# --- Metric known-answer tests ----------------------------------------------

def test_sharpe_known_answer():
    r = np.full(252, 0.001)
    assert bt.sharpe_ratio(r) == 0.0  # zero variance -> guarded to 0
    rng = np.random.default_rng(1)
    x = rng.normal(0.0005, 0.01, 100_000)
    expected = np.sqrt(252) * x.mean() / x.std()
    assert abs(bt.sharpe_ratio(x) - expected) < 1e-9


def test_sharpe_respects_risk_free():
    rng = np.random.default_rng(2)
    x = rng.normal(0.0005, 0.01, 50_000)
    assert bt.sharpe_ratio(x, 0.05) < bt.sharpe_ratio(x, 0.0)


def test_max_drawdown_known_answer():
    eq = np.array([1.0, 2.0, 1.0, 4.0])
    assert abs(bt.max_drawdown_pct(eq) - (-50.0)) < 1e-9


def test_sma_baseline_has_no_lookahead():
    """The SMA baseline must also act on lagged information."""
    closes = _alternating_series(400)
    strat_returns, exposures, _ = bt.sma_crossover_curve(closes)
    ann = bt.annualized_return_pct(strat_returns)
    assert ann < 50.0, f"SMA baseline earned {ann:.1f}%/yr on a zero-drift zig-zag -- it is peeking."


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
