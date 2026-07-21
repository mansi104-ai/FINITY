"""
backtest_lib.py

Shared, honest backtest scaffolding for FINDEC eval scripts:
  - risk/return metrics (Sharpe, Sortino, max drawdown, annualized return)
  - baseline strategies to beat (buy&hold, SMA crossover)
  - a tune/holdout time split so parameters can be chosen on an EARLIER
    segment and reported on a LATER, untouched segment (out-of-sample).

Nothing here fetches data or calls a model -- it operates purely on arrays
of closes / per-day strategy returns, so both eval_recommendation.py and any
future strategy script can reuse the identical, auditable measurement code.

The metric formulas match what eval_recommendation.py used before this
refactor (252-day annualization, downside-only Sortino, running-max
drawdown), so numbers stay comparable across the change.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

TRADING_DAYS = 252


# Volatility below this (per-day, in return units) is treated as zero. An exact
# `std() == 0` test is never satisfied in floating point: a constant series --
# e.g. a strategy that stays flat and earns only the risk-free rate every day --
# has std ~1e-19, not 0, which sailed past the old guard and produced a Sharpe of
# ~7e16. Any series this smooth carries no risk information; report 0.0.
_VOL_EPS = 1e-12


def sharpe_ratio(daily_returns: np.ndarray, risk_free_annual: float = 0.0) -> float:
    if daily_returns.size == 0:
        return 0.0
    excess = daily_returns - risk_free_annual / TRADING_DAYS
    std = excess.std()
    if std < _VOL_EPS:
        return 0.0
    return float(np.sqrt(TRADING_DAYS) * excess.mean() / std)


def sortino_ratio(daily_returns: np.ndarray, risk_free_annual: float = 0.0) -> float:
    if daily_returns.size == 0:
        return 0.0
    excess = daily_returns - risk_free_annual / TRADING_DAYS
    downside = excess[excess < 0]
    downside_std = downside.std() if downside.size else 0.0
    if downside_std < _VOL_EPS:  # see _VOL_EPS: exact == 0 is unreachable in float
        return 0.0
    return float(np.sqrt(TRADING_DAYS) * excess.mean() / downside_std)


def max_drawdown_pct(equity_curve: np.ndarray) -> float:
    if equity_curve.size == 0:
        return 0.0
    running_max = np.maximum.accumulate(equity_curve)
    drawdowns = (equity_curve - running_max) / running_max
    return float(drawdowns.min() * 100)


def annualized_return_pct(daily_returns: np.ndarray) -> float:
    """Annualized geometric return from a series of per-day returns."""
    if daily_returns.size == 0:
        return 0.0
    equity = float(np.prod(1.0 + daily_returns))
    if equity <= 0:
        return -100.0
    return float((equity ** (TRADING_DAYS / len(daily_returns)) - 1) * 100)


@dataclass
class SegmentMetrics:
    """Metrics for one time segment (tune or holdout) of a strategy run."""

    label: str
    n_days: int
    annualized_return_pct: float
    sharpe: float
    sortino: float
    max_drawdown_pct: float
    avg_exposure: float
    win_rate_pct: float
    n_trades: int
    buy_hit_rate_pct: float
    n_buy_signals: int
    actions: dict = field(default_factory=dict)

    def one_line(self) -> str:
        return (
            f"Return={self.annualized_return_pct:>7.2f}%  Sharpe={self.sharpe:>5.2f}  "
            f"Sortino={self.sortino:>5.2f}  MaxDD={self.max_drawdown_pct:>7.2f}%  "
            f"Exp={self.avg_exposure:>4.2f}  Win={self.win_rate_pct:>5.1f}%  "
            f"Trades={self.n_trades:>3d}  BuyHit={self.buy_hit_rate_pct:>5.1f}%(n={self.n_buy_signals})"
        )


def strategy_segment_metrics(
    label: str,
    daily_returns: np.ndarray,
    exposures: np.ndarray,
    buy_signals: list[tuple[int, float]],
    actions: dict,
    n_trades: int,
    risk_free_annual: float = 0.0,
) -> SegmentMetrics:
    """
    Build a SegmentMetrics from the per-day strategy returns / exposures of
    ONE segment. `daily_returns` are the strategy's realized per-day returns
    (already net of costs); `buy_signals` are (day_idx, forward_return)
    pairs whose day_idx falls in this segment.
    """
    equity = np.concatenate([[1.0], np.cumprod(1.0 + daily_returns)]) if daily_returns.size else np.array([1.0])
    traded_mask = exposures != 0.0
    traded_returns = daily_returns[traded_mask] if daily_returns.size else np.array([])
    win_rate = float(np.mean(traded_returns > 0) * 100) if traded_returns.size else 0.0
    buy_hit = float(np.mean([fwd > 0 for _, fwd in buy_signals]) * 100) if buy_signals else 0.0
    return SegmentMetrics(
        label=label,
        n_days=int(daily_returns.size),
        annualized_return_pct=round(annualized_return_pct(daily_returns), 2),
        sharpe=round(sharpe_ratio(daily_returns, risk_free_annual), 2),
        sortino=round(sortino_ratio(daily_returns, risk_free_annual), 2),
        max_drawdown_pct=round(max_drawdown_pct(equity), 2),
        avg_exposure=round(float(np.mean(exposures)) if exposures.size else 0.0, 3),
        win_rate_pct=round(win_rate, 1),
        n_trades=int(n_trades),
        buy_hit_rate_pct=round(buy_hit, 1),
        n_buy_signals=len(buy_signals),
        actions=dict(actions),
    )


# --- Baselines to beat ----------------------------------------------------

def buy_and_hold_segment(
    closes: np.ndarray, label: str = "Buy&Hold", risk_free_annual: float = 0.0
) -> SegmentMetrics:
    """Fully-invested buy&hold over the given close series.

    `closes` must be the SAME day window the strategy's returns were booked over,
    plus one leading close to difference against -- otherwise the benchmark is
    measured over a window offset from the thing it benchmarks (see
    docs/RESEARCH_PLAN.md D2). `evaluate_segments` is responsible for slicing it
    that way; this function just differences whatever it is handed.
    """
    if closes.size < 2:
        return SegmentMetrics(label, 0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0, 0.0, 0, {})
    daily_returns = np.diff(closes) / closes[:-1]
    equity = closes / closes[0]
    return SegmentMetrics(
        label=label,
        n_days=int(daily_returns.size),
        annualized_return_pct=round(annualized_return_pct(daily_returns), 2),
        sharpe=round(sharpe_ratio(daily_returns, risk_free_annual), 2),
        sortino=round(sortino_ratio(daily_returns, risk_free_annual), 2),
        max_drawdown_pct=round(max_drawdown_pct(equity), 2),
        avg_exposure=1.0,
        win_rate_pct=round(float(np.mean(daily_returns > 0) * 100), 1),
        n_trades=1,
        buy_hit_rate_pct=0.0,
        n_buy_signals=0,
        actions={},
    )


def sma_crossover_curve(closes: np.ndarray, short: int = 20, long: int = 50):
    """
    Naive long-only SMA-crossover timing baseline -- the "existing simple
    implementation" bar the FINDEC pipeline should beat. Fully invested the
    day AFTER the short SMA closes above the long SMA (no lookahead: the signal
    at day t uses only closes up to t, applied to day t+1's return), flat
    otherwise. Returns (strat_returns[n-1], exposures[n-1], n_trades) so both
    the metrics and the plotted equity curve come from the identical logic.
    """
    n = closes.size
    if n < long + 2:
        return np.zeros(max(n - 1, 0)), np.zeros(max(n - 1, 0)), 0
    daily_returns = np.diff(closes) / closes[:-1]  # index i = return from day i to i+1
    exposures = np.zeros(n - 1)
    prev_signal = 0.0
    trades = 0
    for i in range(long, n - 1):
        sma_short = float(np.mean(closes[i - short + 1 : i + 1]))
        sma_long = float(np.mean(closes[i - long + 1 : i + 1]))
        signal = 1.0 if sma_short > sma_long else 0.0
        if signal != prev_signal:
            trades += 1
        exposures[i] = signal  # applied to return from day i -> i+1
        prev_signal = signal
    return daily_returns * exposures, exposures, trades


def sma_crossover_segment(
    closes: np.ndarray, short: int = 20, long: int = 50, label: str = "SMA(20/50)",
    risk_free_annual: float = 0.0,
) -> SegmentMetrics:
    """Metrics wrapper around sma_crossover_curve for one close series.

    Like the strategy, this baseline earns the risk-free rate while flat, so the
    two are compared on identical terms.
    """
    n = closes.size
    if n < long + 2:
        return SegmentMetrics(label, 0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0, 0.0, 0, {})
    strat_returns, exposures, trades = sma_crossover_curve(closes, short, long)
    strat_returns = strat_returns + (risk_free_annual / TRADING_DAYS) * (1.0 - exposures)
    equity = np.concatenate([[1.0], np.cumprod(1.0 + strat_returns)])
    traded = strat_returns[exposures != 0.0]
    return SegmentMetrics(
        label=label,
        n_days=int(strat_returns.size),
        annualized_return_pct=round(annualized_return_pct(strat_returns), 2),
        sharpe=round(sharpe_ratio(strat_returns, risk_free_annual), 2),
        sortino=round(sortino_ratio(strat_returns, risk_free_annual), 2),
        max_drawdown_pct=round(max_drawdown_pct(equity), 2),
        avg_exposure=round(float(np.mean(exposures)), 3),
        win_rate_pct=round(float(np.mean(traded > 0) * 100) if traded.size else 0.0, 1),
        n_trades=int(trades),
        buy_hit_rate_pct=0.0,
        n_buy_signals=0,
        actions={},
    )


# --- Out-of-sample split --------------------------------------------------

def split_point(n_evaluated: int, tune_frac: float = 0.6) -> int:
    """
    Index (into the evaluated-day arrays) that separates the earlier tune
    segment from the later holdout segment. Days [0, split) are tune;
    [split, n) are holdout. Parameters are chosen using tune metrics only;
    holdout is reported and never used for tuning.
    """
    return int(round(n_evaluated * tune_frac))
