"""
feature_analysis.py

Phase B, steps 9 and 12 of the improvement plan.

Step 9  -- Feature correlation audit: pools the real engineered feature
           matrix across all tickers (same _build_training_set() the
           live model and eval_analyst.py use, including MACD/Bollinger/
           market-momentum from this phase and the standardization +
           winsorizing from step 10/11), computes the pairwise
           correlation matrix, and flags any pair above --threshold as
           redundant. Reports, does not auto-drop -- dropping a feature
           is a modeling decision that belongs in market_forecaster.py
           with its own before/after eval run, not something this script
           should silently do.

Step 12 -- Feature importance: fits Ridge and the classifier on the
           SAME standardized+winsorized pooled data (step 11's whole
           point is that this is now an apples-to-apples comparison
           between the two models), and reports |standardized
           coefficient| per feature as the importance score. This is a
           legitimate approach specifically BECAUSE the inputs are
           standardized -- on raw features, larger-scale features would
           mechanically get larger-magnitude coefficients regardless of
           real predictive power, which is exactly what step 11 fixes.

USAGE:
    python feature_analysis.py --tickers AAPL MSFT AMZN TSLA NVDA --period 5y
    python feature_analysis.py --corr-threshold 0.85
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd


def _locate_and_add(module_filename: str) -> None:
    here = Path(__file__).resolve().parent
    repo_root = Path(os.environ.get("FINDEC_REPO_ROOT", here.parent))
    candidates = [
        repo_root / "python_agents" / "models",
        repo_root / "python_agents" / "agents",
        repo_root / "python_agents",
        repo_root / "models",
        repo_root,
    ]
    for c in candidates:
        if (c / module_filename).exists():
            sys.path.insert(0, str(c))
            return
    for found in repo_root.rglob(module_filename):
        sys.path.insert(0, str(found.parent))
        return
    print(f"WARNING: could not find {module_filename} under {repo_root}. Set FINDEC_REPO_ROOT.")


_locate_and_add("market_forecaster.py")
from market_forecaster import MarketForecaster  # noqa: E402
from data_fetch import fetch_history  # noqa: E402

# Must match the order features are appended in MarketForecaster._feature_vector().
FEATURE_NAMES = [
    "bias",
    "ret_1d",
    "ret_5d",
    "ret_10d",
    "ret_20d",
    "std_ret_5d",
    "std_ret_10d",
    "ma10_ratio",
    "ma20_ratio",
    "max20_ratio",
    "min20_position",
    "rsi_norm",
    "volume_ratio",
    "macd_histogram",
    "bollinger_pct_b",
    "market_rel_momentum_5d",
]


def build_pooled_dataset(tickers: list[str], period: str, forecaster: MarketForecaster):
    market_df = None
    try:
        market_df = fetch_history("SPY", period)
    except Exception as e:
        print(f"Could not load SPY ({e}); market_rel_momentum_5d will be all-zero.")

    all_X, all_y, per_ticker_rows = [], [], {}
    for ticker in tickers:
        history = fetch_history(ticker, period)
        closes = history["Close"].to_numpy()
        volumes = history["Volume"].to_numpy() if "Volume" in history.columns else np.full(len(closes), np.nan)

        market_closes = None
        if market_df is not None and "Date" in history.columns:
            merged = history[["Date"]].merge(
                market_df[["Date", "Close"]].rename(columns={"Close": "MarketClose"}), on="Date", how="left"
            )
            merged["MarketClose"] = merged["MarketClose"].ffill()
            if not merged["MarketClose"].isna().all():
                market_closes = merged["MarketClose"].to_numpy()

        context = forecaster._context_profile(ticker=ticker, query="", sentiment_score=0.5)
        X, y = forecaster._build_training_set(
            closes=closes, volumes=volumes, horizon_days=context["horizon_days"], market_closes=market_closes
        )
        all_X.append(X)
        all_y.append(y)
        per_ticker_rows[ticker] = len(X)

    X_pooled = np.vstack(all_X)
    y_pooled = np.concatenate(all_y)
    return X_pooled, y_pooled, per_ticker_rows


def correlation_audit(X: np.ndarray, threshold: float) -> pd.DataFrame:
    df = pd.DataFrame(X[:, 1:], columns=FEATURE_NAMES[1:])  # drop bias -- constant, undefined correlation
    corr = df.corr()
    print(f"\n=== Step 9: Feature correlation audit (|r| > {threshold}) ===\n")
    flagged = []
    cols = corr.columns.tolist()
    for i in range(len(cols)):
        for j in range(i + 1, len(cols)):
            r = corr.iloc[i, j]
            if abs(r) > threshold:
                flagged.append((cols[i], cols[j], round(float(r), 3)))
    if not flagged:
        print(f"No feature pairs exceed |r| > {threshold}. No redundancy flagged at this threshold.")
    else:
        for a, b, r in sorted(flagged, key=lambda t: -abs(t[2])):
            print(f"  {a:26s} <-> {b:26s}  r = {r:+.3f}")
        print(f"\n{len(flagged)} pair(s) flagged. Consider dropping one feature per flagged pair in "
              f"market_forecaster.py's _feature_vector() -- keep whichever is cheaper to compute or "
              f"more interpretable, then re-run eval_analyst.py to confirm DA doesn't regress.")
    return corr


def feature_importance(X: np.ndarray, y: np.ndarray, forecaster: MarketForecaster, ridge_alpha: float = 1.8) -> None:
    print("\n=== Step 12: Feature importance (standardized coefficients) ===\n")
    mean, std = forecaster._standardize_fit(X)
    X_scaled = forecaster._standardize_apply(X, mean, std)

    ridge_weights = forecaster._fit_ridge(X=X_scaled, y=y, alpha=ridge_alpha)
    clf_weights = forecaster._fit_logistic(X=X_scaled, y=y, l2=1.0)

    rows = []
    for i, name in enumerate(FEATURE_NAMES):
        if i == 0:
            continue  # bias/intercept isn't a "feature importance"
        rows.append({
            "feature": name,
            "ridge_abs_coef": round(abs(float(ridge_weights[i])), 5),
            "classifier_abs_coef": round(abs(float(clf_weights[i])), 5),
        })
    report = pd.DataFrame(rows).sort_values("ridge_abs_coef", ascending=False).reset_index(drop=True)
    print(report.to_string(index=False))
    print("\nNOTE: these coefficients come from ONE full-sample fit for reporting purposes -- the actual")
    print("model in production/backtest refits per rolling window (see _walk_forward_backtest). Treat this")
    print("as 'which features carry weight on average', not as the live model's exact weights.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tickers", nargs="+", default=["AAPL", "MSFT", "AMZN", "TSLA", "NVDA"])
    parser.add_argument("--period", default="5y")
    parser.add_argument("--corr-threshold", type=float, default=0.9)
    args = parser.parse_args()

    forecaster = MarketForecaster()
    X, y, per_ticker_rows = build_pooled_dataset(args.tickers, args.period, forecaster)
    print(f"Pooled dataset: {X.shape[0]} rows x {X.shape[1]} features, from {per_ticker_rows}")

    correlation_audit(X, args.corr_threshold)
    feature_importance(X, y, forecaster)


if __name__ == "__main__":
    main()