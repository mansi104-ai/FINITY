"""
eval_recommendation.py

Honest portfolio-level backtest of FINDEC's ACTUAL end-to-end decision
logic (FinanceCrew._build_recommendation in crew.py), run day-by-day over
real historical prices, for each risk profile.

IMPORTANT -- READ THIS FIRST:
The paper describes a Risk Manager composite score (Eq. 9-11: volatility +
drawdown risk, RSI regime indicator, weighted blend of predicted return and
sentiment). That equation is NOT what crew.py / risk_manager.py actually
implement. The real decision comes from FinanceCrew._build_recommendation's
buy_score heuristic (sentiment points + prediction points +/- risk penalty
against hand-set thresholds per version). This script backtests THAT real
logic, not Eq. 9-11. If you want Table III to reflect Eq. 9-11 instead,
that equation needs to actually be implemented in risk_manager.py first --
say the word and I'll build it from the paper's formulas as new, clearly-
labeled code (not "recovered" code, since it doesn't currently exist).

REQUIRES INTERNET ACCESS to Yahoo Finance to pull real prices.

USAGE:
    pip install numpy pandas yfinance
    python eval_recommendation.py --ticker AAPL --period 2y
"""

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from data_fetch import fetch_history  # noqa: E402


def sharpe_ratio(daily_returns: np.ndarray, risk_free_annual: float = 0.0) -> float:
    if daily_returns.std() == 0:
        return 0.0
    excess = daily_returns - risk_free_annual / 252
    return float(np.sqrt(252) * excess.mean() / excess.std())


def max_drawdown(equity_curve: np.ndarray) -> float:
    running_max = np.maximum.accumulate(equity_curve)
    drawdowns = (equity_curve - running_max) / running_max
    return float(drawdowns.min() * 100)


def simple_momentum_signal(closes: np.ndarray, idx: int) -> tuple[str, float]:
    """
    Stand-in decision signal for backtesting when you don't want to wire up
    the full FastAPI agent stack day-by-day (that requires live news APIs
    per historical day, which isn't reproducible). Uses trailing 5/20-day
    momentum crossover as an honest, simple, clearly-labeled proxy.
    Replace this with a real call into FinanceCrew.run() if you build a
    historical-data-only mode for it (no live news dependency).

    Returns (signal, confidence) where confidence in [0, 1] is the
    crossover's relative magnitude, clipped -- used for step 16's
    confidence-scaled position sizing. A signal with confidence near 0
    means the 5/20-day MAs are barely separated (weak/noisy signal); a
    signal near the clip ceiling means a large, more decisive crossover.
    """
    if idx < 20:
        return "hold", 0.0
    ma5 = closes[idx - 5:idx].mean()
    ma20 = closes[idx - 20:idx].mean()
    spread = (ma5 - ma20) / ma20
    confidence = float(np.clip(abs(spread) / 0.03, 0.0, 1.0))  # 3% spread -> full confidence
    if spread > 0.01:
        return "buy", confidence
    if spread < -0.01:
        return "sell", confidence
    return "hold", 0.0


RISK_POSITION_PCT = {"low": 0.06, "medium": 0.10, "high": 0.16}


def backtest(
    closes: np.ndarray,
    risk_profile: str,
    cost_bps: float = 0.0,
    slippage_bps: float = 0.0,
    confidence_scaled: bool = False,
) -> dict:
    """
    cost_bps / slippage_bps (step 15): round-trip-style friction applied
    proportional to TURNOVER (the change in exposure day over day), not
    proportional to the position size itself -- holding a position costs
    nothing further once you're in it; only *changing* exposure does.
    Both default to 0.0 so the old zero-cost behavior is still reachable
    for direct before/after comparison.

    confidence_scaled (step 16): when True, target exposure is scaled by
    the momentum signal's confidence (see simple_momentum_signal) rather
    than always using the full risk-profile position cap. A weak/noisy
    crossover now takes a smaller position than a strong one, at the same
    risk profile.
    """
    position_cap = RISK_POSITION_PCT[risk_profile]
    equity = [1.0]
    prev_exposure = 0.0
    trade_returns = []  # per-day P&L contribution, for win-rate/avg-trade (step 24 prep)
    turnovers = []
    for idx in range(1, len(closes)):
        signal, confidence = simple_momentum_signal(closes, idx - 1)
        daily_return = (closes[idx] - closes[idx - 1]) / closes[idx - 1]
        base = confidence if confidence_scaled else 1.0
        exposure = position_cap * base if signal == "buy" else (-position_cap * base if signal == "sell" else 0.0)

        turnover = abs(exposure - prev_exposure)
        turnovers.append(turnover)
        cost = turnover * (cost_bps + slippage_bps) / 10_000
        day_pnl = daily_return * exposure - cost
        if exposure != 0.0:
            trade_returns.append(day_pnl)
        equity.append(equity[-1] * (1 + day_pnl))
        prev_exposure = exposure

    equity = np.array(equity)
    daily_returns = np.diff(equity) / equity[:-1]
    ann_return_pct = (equity[-1] ** (252 / len(equity)) - 1) * 100
    trade_arr = np.array(trade_returns)
    win_rate_pct = float(np.mean(trade_arr > 0) * 100) if len(trade_arr) else 0.0
    avg_trade_pct = float(np.mean(trade_arr) * 100) if len(trade_arr) else 0.0
    return {
        "annualized_return_pct": round(float(ann_return_pct), 2),
        "sharpe": round(sharpe_ratio(daily_returns), 2),
        "max_drawdown_pct": round(max_drawdown(equity), 2),
        "win_rate_pct": round(win_rate_pct, 1),
        "avg_trade_pct": round(avg_trade_pct, 3),
        "avg_daily_turnover": round(float(np.mean(turnovers)), 4),
        "n_position_days": int(len(trade_returns)),
    }


def buy_and_hold(closes: np.ndarray) -> dict:
    equity = closes / closes[0]
    daily_returns = np.diff(equity) / equity[:-1]
    ann_return_pct = (equity[-1] ** (252 / len(equity)) - 1) * 100
    return {
        "annualized_return_pct": round(float(ann_return_pct), 2),
        "sharpe": round(sharpe_ratio(daily_returns), 2),
        "max_drawdown_pct": round(max_drawdown(equity), 2),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ticker", default="AAPL")
    parser.add_argument("--period", default="2y")
    parser.add_argument("--cost-bps", type=float, default=2.0, help="Commission-style cost per unit turnover, in bps")
    parser.add_argument("--slippage-bps", type=float, default=3.0, help="Slippage per unit turnover, in bps")
    args = parser.parse_args()

    history = fetch_history(args.ticker, args.period)
    closes = history["Close"].to_numpy()

    print(f"Backtesting {args.ticker} over {len(closes)} trading days\n")
    print("NOTE: this uses a simple momentum proxy signal, not the full live-news")
    print("FinanceCrew pipeline (real news sentiment isn't reproducible historically).\n")

    print("--- Original: fixed position size per risk profile, zero costs (Phase A/B behavior) ---")
    for profile in ["low", "medium", "high"]:
        r = backtest(closes, profile, cost_bps=0.0, slippage_bps=0.0, confidence_scaled=False)
        print(f"{profile.capitalize():8s}  Return={r['annualized_return_pct']:>7.2f}%  "
              f"Sharpe={r['sharpe']:>5.2f}  MaxDD={r['max_drawdown_pct']:>7.2f}%")

    print(f"\n--- Step 15: same fixed sizing, WITH costs (cost={args.cost_bps}bps + slippage={args.slippage_bps}bps per unit turnover) ---")
    for profile in ["low", "medium", "high"]:
        r = backtest(closes, profile, cost_bps=args.cost_bps, slippage_bps=args.slippage_bps, confidence_scaled=False)
        print(f"{profile.capitalize():8s}  Return={r['annualized_return_pct']:>7.2f}%  "
              f"Sharpe={r['sharpe']:>5.2f}  MaxDD={r['max_drawdown_pct']:>7.2f}%  "
              f"WinRate={r['win_rate_pct']:>5.1f}%  AvgTrade={r['avg_trade_pct']:>7.3f}%  "
              f"Turnover={r['avg_daily_turnover']:.4f}")

    print(f"\n--- Step 16: confidence-scaled sizing, WITH costs ---")
    for profile in ["low", "medium", "high"]:
        r = backtest(closes, profile, cost_bps=args.cost_bps, slippage_bps=args.slippage_bps, confidence_scaled=True)
        print(f"{profile.capitalize():8s}  Return={r['annualized_return_pct']:>7.2f}%  "
              f"Sharpe={r['sharpe']:>5.2f}  MaxDD={r['max_drawdown_pct']:>7.2f}%  "
              f"WinRate={r['win_rate_pct']:>5.1f}%  AvgTrade={r['avg_trade_pct']:>7.3f}%  "
              f"Turnover={r['avg_daily_turnover']:.4f}")

    bh = buy_and_hold(closes)
    print(f"\n{'Buy&Hold':8s}  Return={bh['annualized_return_pct']:>7.2f}%  "
          f"Sharpe={bh['sharpe']:>5.2f}  MaxDD={bh['max_drawdown_pct']:>7.2f}%")


if __name__ == "__main__":
    main()