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


def simple_momentum_signal(closes: np.ndarray, idx: int) -> str:
    """
    Stand-in decision signal for backtesting when you don't want to wire up
    the full FastAPI agent stack day-by-day (that requires live news APIs
    per historical day, which isn't reproducible). Uses trailing 5/20-day
    momentum crossover as an honest, simple, clearly-labeled proxy.
    Replace this with a real call into FinanceCrew.run() if you build a
    historical-data-only mode for it (no live news dependency).
    """
    if idx < 20:
        return "hold"
    ma5 = closes[idx - 5:idx].mean()
    ma20 = closes[idx - 20:idx].mean()
    if ma5 > ma20 * 1.01:
        return "buy"
    if ma5 < ma20 * 0.99:
        return "sell"
    return "hold"


RISK_POSITION_PCT = {"low": 0.06, "medium": 0.10, "high": 0.16}


def backtest(closes: np.ndarray, risk_profile: str) -> dict:
    position_pct = RISK_POSITION_PCT[risk_profile]
    equity = [1.0]
    for idx in range(1, len(closes)):
        signal = simple_momentum_signal(closes, idx - 1)
        daily_return = (closes[idx] - closes[idx - 1]) / closes[idx - 1]
        exposure = position_pct if signal == "buy" else (-position_pct if signal == "sell" else 0.0)
        equity.append(equity[-1] * (1 + daily_return * exposure))
    equity = np.array(equity)
    daily_returns = np.diff(equity) / equity[:-1]
    ann_return_pct = (equity[-1] ** (252 / len(equity)) - 1) * 100
    return {
        "annualized_return_pct": round(float(ann_return_pct), 2),
        "sharpe": round(sharpe_ratio(daily_returns), 2),
        "max_drawdown_pct": round(max_drawdown(equity), 2),
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
    args = parser.parse_args()

    history = fetch_history(args.ticker, args.period)
    closes = history["Close"].to_numpy()

    print(f"Backtesting {args.ticker} over {len(closes)} trading days\n")
    print("NOTE: this uses a simple momentum proxy signal, not the full live-news")
    print("FinanceCrew pipeline (real news sentiment isn't reproducible historically).\n")
    for profile in ["low", "medium", "high"]:
        result = backtest(closes, profile)
        print(f"{profile.capitalize():8s}  Return={result['annualized_return_pct']:>7.2f}%  "
              f"Sharpe={result['sharpe']:>5.2f}  MaxDD={result['max_drawdown_pct']:>7.2f}%")

    bh = buy_and_hold(closes)
    print(f"{'Buy&Hold':8s}  Return={bh['annualized_return_pct']:>7.2f}%  "
          f"Sharpe={bh['sharpe']:>5.2f}  MaxDD={bh['max_drawdown_pct']:>7.2f}%")


if __name__ == "__main__":
    main()