"""
eval_analyst.py

Honest walk-forward evaluation of the FINDEC Analyst Agent.

Calls the REAL MarketForecaster._walk_forward_backtest() (Ridge Regression
on the actual engineered features) against REAL historical OHLCV data
pulled live via yfinance. Reports whatever directional accuracy / MAE
actually comes out -- no target numbers, no tuning to match prior claims.

REQUIRES INTERNET ACCESS to Yahoo Finance. Run this on your own machine
or your deployed server, not in a sandboxed environment without egress
to finance.yahoo.com.

USAGE:
    pip install numpy pandas yfinance
    python eval_analyst.py --tickers AAPL MSFT AMZN TSLA NVDA --period 3y

NOTE ON DISCREPANCIES WITH THE PAPER (read before you run this):
  1. The paper states a sliding window of W=60 days. The current code
     (AssetConfig for "equity") uses train_window=220. This script uses
     whatever is actually configured in market_forecaster.py -- if you
     want the paper's W=60 behavior, edit ASSET_CONFIGS in that file
     first, then re-run this script and report the new numbers.
  2. The paper's feature vector (Eq. 3) includes normalized volume
     V_t/V̄. The current _feature_vector() has no volume term. Either
     add it to the code or correct the paper -- don't report Eq. 3 as
     the feature set if volume isn't actually used.
  3. This script evaluates the RAW model (_walk_forward_backtest), which
     does NOT include the keyword-based "macro overlay" or sentiment
     adjustments applied in the live predict() path. That's intentional --
     those overlays are hand-tuned heuristics, not something you can
     validate with backtesting, and reporting backtest numbers as if they
     reflect the full predict() pipeline would be misleading.
"""

import argparse
import os
import sys
from pathlib import Path


def _locate_and_add(module_filename: str) -> None:
    """
    Finds module_filename somewhere under the repo and adds its folder to
    sys.path, so `from <module> import ...` works regardless of your repo
    layout. Override with env var FINDEC_REPO_ROOT if autodetect fails.
    """
    here = Path(__file__).resolve().parent
    repo_root = Path(os.environ.get("FINDEC_REPO_ROOT", here.parent))

    candidates = [
        repo_root / "python_agents" / "models",
        repo_root / "python_agents" / "agents",
        repo_root / "python_agents",
        repo_root / "models",
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

    print(f"WARNING: could not find {module_filename} under {repo_root}.\n"
          f"Set FINDEC_REPO_ROOT to your repo's root folder, e.g.:\n"
          f"  set FINDEC_REPO_ROOT=C:\\Users\\mansi\\FINITY   (Windows)\n"
          f"  export FINDEC_REPO_ROOT=/path/to/FINITY        (Mac/Linux)")


_locate_and_add("market_forecaster.py")
from market_forecaster import MarketForecaster  # noqa: E402

import time
import numpy as np
from data_fetch import fetch_history  # noqa: E402





def evaluate_ticker(ticker: str, period: str, forecaster: MarketForecaster) -> dict:
    history = fetch_history(ticker, period)
    closes = history["Close"].to_numpy()
    volumes = history["Volume"].to_numpy() if "Volume" in history.columns else np.full(len(closes), np.nan)

    context = forecaster._context_profile(ticker=ticker, query="", sentiment_score=0.5)
    features, targets = forecaster._build_training_set(closes=closes, volumes=volumes, horizon_days=context["horizon_days"])
    backtest = forecaster._walk_forward_backtest(features=features, targets=targets, config=context["config"])

    return {
        "ticker": ticker,
        "samples": int(backtest["samples"]),
        "directional_accuracy_pct": round(backtest["directional_accuracy_pct"], 1),
        "directional_accuracy_ensemble_pct": round(backtest.get("directional_accuracy_ensemble_pct", backtest["directional_accuracy_pct"]), 1),
        "mae_pct": round(backtest["mae_pct"], 2),
        "rmse_pct": round(backtest["rmse_pct"], 2),
        "train_window_used": context["config"].train_window,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tickers", nargs="+", default=["AAPL", "MSFT", "AMZN", "TSLA", "NVDA"])
    parser.add_argument("--period", default="3y", help="yfinance period, e.g. 1y, 3y, 5y")
    parser.add_argument("--delay", type=float, default=3.0,
                         help="seconds to wait between tickers (only matters when falling back to "
                              "live yfinance/Stooq; local CSV reads don't need this)")
    args = parser.parse_args()

    forecaster = MarketForecaster()
    results = []
    for i, ticker in enumerate(args.tickers):
        if i > 0:
            time.sleep(args.delay)
        try:
            result = evaluate_ticker(ticker, args.period, forecaster)
            results.append(result)
            print(f"{ticker}: DA(ridge)={result['directional_accuracy_pct']}%  "
                  f"DA(ensemble)={result['directional_accuracy_ensemble_pct']}%  "
                  f"nMAE={result['mae_pct']}%  RMSE={result['rmse_pct']}%  "
                  f"n={result['samples']}  (train_window={result['train_window_used']})")
        except Exception as e:
            print(f"{ticker}: FAILED - {e}")

    if results:
        avg_da = sum(r["directional_accuracy_pct"] for r in results) / len(results)
        avg_da_ensemble = sum(r["directional_accuracy_ensemble_pct"] for r in results) / len(results)
        avg_mae = sum(r["mae_pct"] for r in results) / len(results)
        print(f"\nAverage across {len(results)} tickers: "
              f"DA(ridge)={avg_da:.1f}%  DA(ensemble)={avg_da_ensemble:.1f}%  nMAE={avg_mae:.2f}%")
        print("\nThese are REAL measured numbers. If they differ from the paper's")
        print("Table II, that's expected until you resolve the config discrepancies")
        print("noted at the top of this file.")


if __name__ == "__main__":
    main()