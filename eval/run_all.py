"""
run_all.py  --  FINDEC's one-command evaluation dashboard.

WHAT "EVALUATION" MEANS (plain English)
  "Evaluating" a model means: run it on real historical data it never got to
  peek at, then measure -- with honest numbers -- whether its outputs were any
  good. FINDEC has three things worth evaluating, and this script runs all three
  and draws the results:

    1. RESEARCHER  -- does the news-sentiment classifier label headlines
       correctly? Measured as accuracy vs. human labels.
    2. ANALYST     -- when the forecaster says "up" or "down", is it right more
       than a coin flip? Measured as walk-forward DIRECTIONAL ACCURACY (>50% =
       better than chance) and average error (MAE).
    3. RECOMMENDATION -- if you had actually followed FINDEC's buy/hold/sell
       calls, would you have done better than just buying and holding the stock?
       Measured out-of-sample vs. two baselines (Buy&Hold and a naive SMA
       crossover), on RETURN, SHARPE (return per unit of risk), and DRAWDOWN
       (worst peak-to-trough loss).

  "Out-of-sample" = we choose any settings on an earlier slice of history (TUNE)
  and report the score on a later slice the tuning never saw (HOLDOUT). That is
  the only honest way to claim "better than the baseline" -- otherwise you are
  just describing the past, not predicting.

OUTPUT
  - A plain-English summary table in the terminal.
  - PNG charts in eval/results/ : per-ticker equity + drawdown curves, and a
    cross-ticker dashboard (Sharpe, risk/return, directional accuracy).

USAGE
    pip install numpy pandas matplotlib
    python run_all.py                       # all 5 bundled tickers
    python run_all.py --tickers AAPL TSLA   # a subset
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd

import matplotlib
matplotlib.use("Agg")  # no display needed; we save PNGs
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter

import backtest_lib as bt
import eval_recommendation as er

# Make the agent modules importable (mirrors eval_recommendation's locator).
_repo_root = Path(os.environ.get("FINDEC_REPO_ROOT", Path(__file__).resolve().parent.parent))
for _p in (str(_repo_root / "python_agents"), str(_repo_root)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from market_forecaster import MarketForecaster  # noqa: E402
from risk_manager import RiskManagerAgent  # noqa: E402
from risk_reasoning import RiskReasoningAgent  # noqa: E402
from verification import VerificationAgent  # noqa: E402
from crew import FinanceCrew  # noqa: E402
from data_fetch import fetch_history  # noqa: E402
import eval_analyst  # noqa: E402
import eval_researcher  # noqa: E402

# --- FINDEC brand palette (validated colorblind-safe; see run_all docstring) ---
C_FINDEC = "#246bff"   # brand blue -- the FINDEC strategy (the hero)
C_BENCH = "#6b7280"    # neutral gray -- Buy&Hold benchmark
C_SMA = "#b8860b"      # dark amber -- naive SMA baseline
C_POS = "#1f8a4c"      # green -- positive / ensemble
C_NEG = "#e66154"      # coral -- drawdown / negative
INK = "#1f2430"
MUTED = "#6b7280"
SURFACE = "#fcfcfb"
HOLDOUT_SHADE = "#246bff"

RESULTS_DIR = Path(__file__).parent / "results"


def _style_ax(ax):
    """Recessive grid, no top/right spines, muted ticks -- clean fintech look."""
    ax.set_facecolor(SURFACE)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color("#d7d9de")
    ax.tick_params(colors=MUTED, labelsize=9)
    ax.grid(True, color="#eceded", linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)


def _equity_from_returns(daily_returns: np.ndarray) -> np.ndarray:
    return np.cumprod(1.0 + daily_returns) if daily_returns.size else np.array([1.0])


def _drawdown(equity: np.ndarray) -> np.ndarray:
    running_max = np.maximum.accumulate(equity)
    return (equity - running_max) / running_max * 100.0


def collect_ticker(ticker: str, period: str, profile: str, params: er.StrategyParams,
                   agents: dict, forecaster: MarketForecaster, tune_frac: float) -> dict:
    """Run the recommendation backtest for one ticker and return everything the
    summary + charts need: aligned equity curves and tune/holdout metrics."""
    history = fetch_history(ticker, period)
    closes = history["Close"].astype(float).to_numpy()
    dates = pd.to_datetime(history["Date"]).to_numpy() if "Date" in history else np.arange(len(closes))
    n = len(closes)
    min_start = min(260, max(120, n // 3))
    idxs = list(range(min_start, n, params.rebalance_days))
    cache_key = f"{ticker}_{period}_r{params.rebalance_days}_s{min_start}"
    predictions = er.precompute_predictions(history, ticker, forecaster, idxs, cache_key=cache_key)

    records = er.run_strategy(history, ticker, predictions, profile, params, min_start, agents)
    segs = er.evaluate_segments(records, closes, tune_frac)

    n_eval = records["day_returns"].size
    seg_dates = dates[min_start: min_start + n_eval]
    findec_eq = _equity_from_returns(records["day_returns"])
    bh_eq = closes[min_start: min_start + n_eval] / closes[min_start]
    sma_ret_full, _, _ = bt.sma_crossover_curve(closes)
    sma_eq_full = np.concatenate([[1.0], np.cumprod(1.0 + sma_ret_full)])  # len n, indexed by day
    sma_seg = sma_eq_full[min_start: min_start + n_eval]
    sma_eq = sma_seg / sma_seg[0] if sma_seg.size else sma_seg

    return {
        "ticker": ticker, "dates": seg_dates, "min_start": min_start,
        "findec_eq": findec_eq, "bh_eq": bh_eq, "sma_eq": sma_eq,
        "cut": bt.split_point(n_eval, tune_frac), "segs": segs,
    }


def plot_ticker(data: dict, profile: str, out_dir: Path) -> Path:
    """Per-ticker figure: growth-of-$1 equity curves (top) + drawdown (bottom),
    with the out-of-sample HOLDOUT region shaded."""
    ticker = data["ticker"]
    dates, cut = data["dates"], data["cut"]
    hold = data["segs"]["holdout"]
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 7), height_ratios=[2.4, 1], sharex=True)
    fig.patch.set_facecolor(SURFACE)

    # Shade the out-of-sample holdout region across both panels.
    x_cut = dates[cut] if cut < len(dates) else dates[-1]
    for ax in (ax1, ax2):
        _style_ax(ax)
        ax.axvspan(x_cut, dates[-1], color=HOLDOUT_SHADE, alpha=0.05, zorder=0)
        ax.axvline(x_cut, color=MUTED, lw=1, ls=":", zorder=1)

    ax1.plot(dates, data["bh_eq"], color=C_BENCH, lw=1.8, ls="--", label="Buy & Hold", zorder=3)
    ax1.plot(dates, data["sma_eq"], color=C_SMA, lw=1.6, ls="-.", label="SMA(20/50)", zorder=3)
    ax1.plot(dates, data["findec_eq"], color=C_FINDEC, lw=2.4, label=f"FINDEC ({profile})", zorder=4)
    # Direct end-labels (final growth multiple).
    for series, color in ((data["findec_eq"], C_FINDEC), (data["bh_eq"], C_BENCH)):
        ax1.annotate(f"{series[-1]:.2f}x", xy=(dates[-1], series[-1]), xytext=(6, 0),
                     textcoords="offset points", va="center", fontsize=9, color=color, fontweight="bold")
    ax1.set_ylabel("Growth of $1", color=INK, fontsize=10)
    ax1.set_title(f"{ticker}  —  growth of $1  (shaded = out-of-sample holdout)",
                  color=INK, fontsize=13, fontweight="bold", loc="left", pad=10)
    ax1.legend(loc="upper left", frameon=False, fontsize=9)
    ax1.text(0.5, 0.02,
             f"Holdout: FINDEC return {hold['strategy'].annualized_return_pct:.1f}%  "
             f"Sharpe {hold['strategy'].sharpe:.2f}  MaxDD {hold['strategy'].max_drawdown_pct:.1f}%   |   "
             f"Buy&Hold return {hold['buyhold'].annualized_return_pct:.1f}%  "
             f"Sharpe {hold['buyhold'].sharpe:.2f}  MaxDD {hold['buyhold'].max_drawdown_pct:.1f}%",
             transform=ax1.transAxes, ha="center", fontsize=8, color=MUTED)

    # Drawdown (underwater): how far below the prior peak, in %.
    ax2.fill_between(dates, _drawdown(data["findec_eq"]), 0, color=C_NEG, alpha=0.28, zorder=2)
    ax2.plot(dates, _drawdown(data["findec_eq"]), color=C_NEG, lw=1.6, label="FINDEC", zorder=3)
    ax2.plot(dates, _drawdown(data["bh_eq"]), color=C_BENCH, lw=1.4, ls="--", label="Buy & Hold", zorder=3)
    ax2.set_ylabel("Drawdown %", color=INK, fontsize=10)
    ax2.legend(loc="lower left", frameon=False, fontsize=9)
    ax2.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:.0f}%"))

    fig.tight_layout()
    path = out_dir / f"{ticker}_equity.png"
    fig.savefig(path, dpi=140, facecolor=SURFACE)
    plt.close(fig)
    return path


def plot_dashboard(all_data: list, analyst_rows: list, profile: str, out_dir: Path) -> Path:
    """Cross-ticker dashboard: Sharpe vs baselines, risk/return map, directional
    accuracy vs the 50% coin-flip line."""
    tickers = [d["ticker"] for d in all_data]
    fig, axes = plt.subplots(1, 3, figsize=(16, 5.2))
    fig.patch.set_facecolor(SURFACE)
    for ax in axes:
        _style_ax(ax)

    # (A) Sharpe by ticker: FINDEC vs Buy&Hold vs SMA (holdout, out-of-sample).
    axA = axes[0]
    x = np.arange(len(tickers)); w = 0.26
    findec_sh = [d["segs"]["holdout"]["strategy"].sharpe for d in all_data]
    bh_sh = [d["segs"]["holdout"]["buyhold"].sharpe for d in all_data]
    sma_sh = [d["segs"]["holdout"]["sma"].sharpe for d in all_data]
    axA.bar(x - w, bh_sh, w, color=C_BENCH, label="Buy & Hold")
    axA.bar(x, sma_sh, w, color=C_SMA, label="SMA(20/50)")
    axA.bar(x + w, findec_sh, w, color=C_FINDEC, label=f"FINDEC ({profile})")
    axA.axhline(0, color="#c9ccd1", lw=1)
    axA.set_xticks(x); axA.set_xticklabels(tickers)
    axA.set_title("Sharpe ratio (higher = better risk-adjusted return)", color=INK,
                  fontsize=11, fontweight="bold", loc="left")
    axA.legend(frameon=False, fontsize=8, loc="upper right")

    # (B) Risk/return map: y = return, x = |max drawdown|. Arrow B&H -> FINDEC.
    axB = axes[1]
    for d in all_data:
        h = d["segs"]["holdout"]
        bx, by = abs(h["buyhold"].max_drawdown_pct), h["buyhold"].annualized_return_pct
        fx, fy = abs(h["strategy"].max_drawdown_pct), h["strategy"].annualized_return_pct
        axB.annotate("", xy=(fx, fy), xytext=(bx, by),
                     arrowprops=dict(arrowstyle="->", color="#b8bcc4", lw=1.2))
        axB.scatter(bx, by, s=45, color=C_BENCH, zorder=3)
        axB.scatter(fx, fy, s=70, color=C_FINDEC, zorder=4, edgecolor="white", linewidth=1)
        axB.annotate(d["ticker"], xy=(fx, fy), xytext=(4, 5), textcoords="offset points",
                     fontsize=8, color=INK, fontweight="bold")
    axB.axhline(0, color="#c9ccd1", lw=1)
    axB.scatter([], [], color=C_FINDEC, label="FINDEC"); axB.scatter([], [], color=C_BENCH, label="Buy & Hold")
    axB.set_xlabel("Max drawdown %  (← left = safer, smaller loss)", color=MUTED, fontsize=9)
    axB.set_ylabel("Annualized return %", color=INK, fontsize=10)
    axB.set_title("Risk / return map  (up-and-left is better)", color=INK,
                  fontsize=11, fontweight="bold", loc="left")
    axB.legend(frameon=False, fontsize=8, loc="lower right")

    # (C) Analyst directional accuracy: ridge vs ensemble vs 50% coin flip.
    axC = axes[2]
    a_tick = [r["ticker"] for r in analyst_rows]
    xa = np.arange(len(a_tick)); wa = 0.36
    ridge = [r["ridge"] for r in analyst_rows]
    ens = [r["ensemble"] for r in analyst_rows]
    axC.bar(xa - wa / 2, ridge, wa, color=C_FINDEC, label="Ridge")
    axC.bar(xa + wa / 2, ens, wa, color=C_POS, label="Ensemble")
    axC.axhline(50, color=C_NEG, lw=1.4, ls="--", label="50% coin flip")
    axC.set_ylim(35, max(70, max(ridge + ens) + 5))
    axC.set_xticks(xa); axC.set_xticklabels(a_tick)
    axC.set_title("Analyst directional accuracy (>50% beats chance)", color=INK,
                  fontsize=11, fontweight="bold", loc="left")
    axC.legend(frameon=False, fontsize=8, loc="upper right")

    fig.suptitle(f"FINDEC evaluation dashboard  —  out-of-sample holdout, profile={profile}",
                 color=INK, fontsize=14, fontweight="bold", x=0.01, ha="left")
    fig.tight_layout(rect=[0, 0, 1, 0.96])
    path = out_dir / "dashboard.png"
    fig.savefig(path, dpi=140, facecolor=SURFACE)
    plt.close(fig)
    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tickers", nargs="+", default=["AAPL", "MSFT", "AMZN", "TSLA", "NVDA"])
    parser.add_argument("--period", default="3y")
    parser.add_argument("--profile", default="high", help="risk profile shown in the equity charts")
    parser.add_argument("--rebalance-days", type=int, default=10)
    parser.add_argument("--tune-frac", type=float, default=0.6)
    args = parser.parse_args()

    RESULTS_DIR.mkdir(exist_ok=True)
    params = er.StrategyParams(rebalance_days=args.rebalance_days)
    agents = {"risk_manager": RiskManagerAgent(), "risk_reasoner": RiskReasoningAgent(),
              "verifier": VerificationAgent(), "crew": FinanceCrew()}
    forecaster = MarketForecaster()

    print(__doc__.split("USAGE")[0])
    print("=" * 78)

    # 1) RESEARCHER --------------------------------------------------------
    print("\n[1/3] RESEARCHER  (news-sentiment classifier accuracy)")
    y_true, y_pred = eval_researcher.evaluate(eval_researcher.DEMO_FIXTURE)
    acc = 100.0 * sum(t == p for t, p in zip(y_true, y_pred)) / max(len(y_true), 1)
    print(f"      Demo-fixture accuracy: {acc:.0f}%  ({len(y_true)} labeled headlines)")
    print("      -> For a full number, run: python eval_researcher.py --data data/all-data.csv")

    # 2) ANALYST -----------------------------------------------------------
    print("\n[2/3] ANALYST  (walk-forward directional accuracy -- is 'up/down' better than chance?)")
    market_df = None
    try:
        market_df = fetch_history("SPY", args.period)
    except Exception:
        pass
    analyst_rows = []
    for t in args.tickers:
        try:
            r = eval_analyst.evaluate_ticker(t, args.period, forecaster, market_df=market_df)
            analyst_rows.append({"ticker": t, "ridge": r["directional_accuracy_pct"],
                                 "ensemble": r["directional_accuracy_ensemble_pct"], "mae": r["mae_pct"]})
            print(f"      {t}: directional accuracy {r['directional_accuracy_ensemble_pct']:.1f}% "
                  f"(ridge {r['directional_accuracy_pct']:.1f}%),  avg error {r['mae_pct']:.2f}%")
        except Exception as e:
            print(f"      {t}: FAILED -- {e}")

    # 3) RECOMMENDATION ----------------------------------------------------
    print("\n[3/3] RECOMMENDATION  (following FINDEC's calls vs. just holding the stock, out-of-sample)")
    all_data = []
    for t in args.tickers:
        try:
            all_data.append(collect_ticker(t, args.period, args.profile, params, agents, forecaster, args.tune_frac))
        except Exception as e:
            print(f"      {t}: FAILED -- {e}")

    print(f"\n      {'Ticker':7s}{'FINDEC ret':>11s}{'B&H ret':>9s}{'FINDEC Sharpe':>15s}"
          f"{'B&H Sharpe':>12s}{'FINDEC DD':>11s}{'B&H DD':>9s}   verdict")
    beat_sharpe = beat_both = 0
    for d in all_data:
        h = d["segs"]["holdout"]; s, b = h["strategy"], h["buyhold"]
        wins_sharpe = s.sharpe > b.sharpe
        wins_both = wins_sharpe and s.annualized_return_pct > b.annualized_return_pct
        beat_sharpe += wins_sharpe; beat_both += wins_both
        verdict = "beats B&H (both)" if wins_both else ("beats B&H (Sharpe)" if wins_sharpe else "trails B&H")
        print(f"      {d['ticker']:7s}{s.annualized_return_pct:>10.1f}%{b.annualized_return_pct:>8.1f}%"
              f"{s.sharpe:>15.2f}{b.sharpe:>12.2f}{s.max_drawdown_pct:>10.1f}%{b.max_drawdown_pct:>8.1f}%   {verdict}")
    n = len(all_data)
    print(f"\n      SCORE (holdout): beats Buy&Hold on Sharpe {beat_sharpe}/{n} tickers, "
          f"on BOTH return & Sharpe {beat_both}/{n}.")

    # 4) CHARTS ------------------------------------------------------------
    print("\nGenerating charts ...")
    for d in all_data:
        p = plot_ticker(d, args.profile, RESULTS_DIR)
        print(f"      wrote {p.relative_to(Path.cwd())}" if Path.cwd() in p.parents else f"      wrote {p}")
    if all_data and analyst_rows:
        p = plot_dashboard(all_data, analyst_rows, args.profile, RESULTS_DIR)
        print(f"      wrote {p}")
    print(f"\nDone. Charts are in: {RESULTS_DIR}")


if __name__ == "__main__":
    main()
