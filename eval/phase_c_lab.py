"""
phase_c_lab.py

Phase C, steps 13, 14, 17, 18, 19, 20 of the improvement plan -- run
together because they share the same tune/test split machinery, and
running them separately would mean repeating (and risking
inconsistency in) that split logic five times.

METHODOLOGY (this is the important part, read before trusting any
number this script prints):

Every ticker's feature/target series is split chronologically:
  - TUNE   = first --tune-frac of rows (default 70%)
  - TEST   = remaining rows, never touched during any grid search

Steps 13 (Ridge alpha) and 14 (classifier l2) grid-search ONLY on TUNE
(via the existing walk-forward backtest, which evaluates its own
trailing slice of whatever array it's given). Whatever hyperparameter
wins on TUNE is then evaluated exactly once on TEST, and the TEST
number -- not the TUNE number -- is what should be quoted as "the"
result, because a hyperparameter chosen and scored on the same data
will look better than it really is (this is precisely the tuning-set
leakage step 22 asks about; steps 13/14 are done properly here rather
than deferring the concern to Phase D).

Steps 17 (pooled training), 18 (volatility filter), and 19 (rolling vs
expanding) are each compared on TEST using the alpha/l2 chosen on TUNE,
so every comparison in this script's final table is apples-to-apples
on data none of the hyperparameters were chosen against.

Step 20 (gradient boosting) is fit fresh per walk-forward window on
TUNE-derived standardization stats and scored on TEST the same way, as
a second candidate model to compare against, not to replace, Ridge.

CAVEAT this script does NOT paper over: TEST is only ~30% of a 5-year
per-ticker series, and the existing walk-forward backtest itself only
scores its trailing ~120 rows -- so "TEST" results here are still a
few-hundred-sample estimate, not a large-sample guarantee. Treat
directional differences under a few points as noise; see step 21 in
Phase D for the actual significance test.

USAGE:
    python phase_c_lab.py --tickers AAPL MSFT AMZN TSLA NVDA --period 5y
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import numpy as np


def _locate_and_add(module_filename: str) -> None:
    here = Path(__file__).resolve().parent
    repo_root = Path(os.environ.get("FINDEC_REPO_ROOT", here.parent))
    candidates = [repo_root / "python_agents" / "models", repo_root / "python_agents", repo_root]
    for c in candidates:
        if (c / module_filename).exists():
            sys.path.insert(0, str(c))
            return
    for found in repo_root.rglob(module_filename):
        sys.path.insert(0, str(found.parent))
        return


_locate_and_add("market_forecaster.py")
from market_forecaster import MarketForecaster  # noqa: E402
from data_fetch import fetch_history  # noqa: E402

RIDGE_ALPHA_GRID = [0.1, 0.5, 1.0, 1.8, 3.0, 5.0, 10.0, 20.0]
CLASSIFIER_L2_GRID = [0.1, 0.5, 1.0, 2.0, 5.0]
VOL_FILTER_GRID = [None, 1.5, 2.0, 2.5]


def load_ticker_features(ticker: str, period: str, forecaster: MarketForecaster, market_df):
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
    return X, y, context["config"]


def tune_test_split(X, y, tune_frac: float):
    cut = int(len(X) * tune_frac)
    return X[:cut], y[:cut], X[cut:], y[cut:]


def grid_search_alpha(forecaster, tune_by_ticker, config) -> float:
    best_alpha, best_da = config.ridge_alpha, -1.0
    for alpha in RIDGE_ALPHA_GRID:
        das = []
        for X_tune, y_tune in tune_by_ticker.values():
            r = forecaster._walk_forward_backtest(features=X_tune, targets=y_tune, config=config, ridge_alpha_override=alpha)
            if r["samples"] > 0:
                das.append(r["directional_accuracy_pct"])
        avg_da = float(np.mean(das)) if das else -1.0
        print(f"    alpha={alpha:<6} tune-avg-DA={avg_da:.1f}%")
        if avg_da > best_da:
            best_da, best_alpha = avg_da, alpha
    return best_alpha


def grid_search_l2(forecaster, tune_by_ticker, config, alpha) -> float:
    best_l2, best_da = 1.0, -1.0
    for l2 in CLASSIFIER_L2_GRID:
        das = []
        for X_tune, y_tune in tune_by_ticker.values():
            r = forecaster._walk_forward_backtest(
                features=X_tune, targets=y_tune, config=config,
                ridge_alpha_override=alpha, classifier_l2_override=l2,
            )
            if r["samples"] > 0:
                das.append(r["directional_accuracy_ensemble_pct"])
        avg_da = float(np.mean(das)) if das else -1.0
        print(f"    l2={l2:<6} tune-avg-ensemble-DA={avg_da:.1f}%")
        if avg_da > best_da:
            best_da, best_l2 = avg_da, l2
    return best_l2


def gradient_boosting_walkforward(forecaster, X, y, config) -> dict:
    """Step 20: same rolling-window protocol as _walk_forward_backtest,
    but with sklearn's HistGradientBoostingClassifier as the direction
    model instead of the logistic classifier, for a like-for-like
    comparison. Compared against, does not replace, Ridge/logistic."""
    from sklearn.ensemble import HistGradientBoostingClassifier

    preds, actuals = [], []
    start = max(config.min_train_size, len(X) - 120)
    for idx in range(start, len(X)):
        train_start = max(0, idx - config.train_window)
        X_train, y_train = X[train_start:idx], y[train_start:idx]
        if len(X_train) < config.min_train_size:
            continue
        mean, std = forecaster._standardize_fit(X_train)
        X_train_scaled = forecaster._standardize_apply(X_train, mean, std)
        point_scaled = forecaster._standardize_apply(X[idx], mean, std)
        y_binary = (y_train > 0).astype(int)
        if len(np.unique(y_binary)) < 2:
            continue
        clf = HistGradientBoostingClassifier(max_iter=50, max_depth=3, learning_rate=0.1, random_state=0)
        clf.fit(X_train_scaled[:, 1:], y_binary)
        prob_up = clf.predict_proba(point_scaled[1:].reshape(1, -1))[0, 1]
        preds.append(1 if prob_up >= 0.5 else -1)
        actuals.append(1 if y[idx] > 0 else -1)
    if not preds:
        return {"samples": 0, "directional_accuracy_pct": 50.0}
    da = float(np.mean(np.array(preds) == np.array(actuals)) * 100)
    return {"samples": len(preds), "directional_accuracy_pct": da}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tickers", nargs="+", default=["AAPL", "MSFT", "AMZN", "TSLA", "NVDA"])
    parser.add_argument("--period", default="5y")
    parser.add_argument("--tune-frac", type=float, default=0.7)
    args = parser.parse_args()

    forecaster = MarketForecaster()
    market_df = None
    try:
        market_df = fetch_history("SPY", args.period)
    except Exception as e:
        print(f"Could not load SPY ({e}); continuing without it.")

    data_by_ticker, config = {}, None
    for t in args.tickers:
        X, y, cfg = load_ticker_features(t, args.period, forecaster, market_df)
        data_by_ticker[t] = (X, y)
        config = cfg  # same AssetConfig (equity) for all tickers here

    tune_by_ticker = {t: tune_test_split(X, y, args.tune_frac)[:2] for t, (X, y) in data_by_ticker.items()}
    test_by_ticker = {t: tune_test_split(X, y, args.tune_frac)[2:] for t, (X, y) in data_by_ticker.items()}

    print("\n=== Step 13: Ridge alpha grid search (scored on TUNE only) ===")
    best_alpha = grid_search_alpha(forecaster, tune_by_ticker, config)
    print(f"  -> selected alpha = {best_alpha} (current hardcoded config value: {config.ridge_alpha})")

    print("\n=== Step 14: Classifier l2 grid search (scored on TUNE only, using selected alpha) ===")
    best_l2 = grid_search_l2(forecaster, tune_by_ticker, config, best_alpha)
    print(f"  -> selected l2 = {best_l2}")

    print(f"\n=== Held-out TEST evaluation with alpha={best_alpha}, l2={best_l2} (never used in the search above) ===")
    baseline_test_das, tuned_test_das = [], []
    for t, (X_test, y_test) in test_by_ticker.items():
        baseline = forecaster._walk_forward_backtest(features=X_test, targets=y_test, config=config)
        tuned = forecaster._walk_forward_backtest(
            features=X_test, targets=y_test, config=config,
            ridge_alpha_override=best_alpha, classifier_l2_override=best_l2,
        )
        baseline_test_das.append(baseline["directional_accuracy_pct"])
        tuned_test_das.append(tuned["directional_accuracy_pct"])
        print(f"  {t}: DA(ridge) baseline(alpha={config.ridge_alpha})={baseline['directional_accuracy_pct']:.1f}%  "
              f"-> tuned(alpha={best_alpha})={tuned['directional_accuracy_pct']:.1f}%   n={tuned['samples']:.0f}")
    print(f"  TEST-set average: baseline={np.mean(baseline_test_das):.1f}%  tuned={np.mean(tuned_test_das):.1f}%")

    print(f"\n=== Step 19: rolling vs expanding window (alpha={best_alpha}, TEST only) ===")
    for mode in ("rolling", "expanding"):
        das = []
        for t, (X_test, y_test) in test_by_ticker.items():
            r = forecaster._walk_forward_backtest(
                features=X_test, targets=y_test, config=config,
                ridge_alpha_override=best_alpha, window_mode=mode,
            )
            das.append(r["directional_accuracy_pct"])
        print(f"  {mode:10s} TEST-set average DA = {np.mean(das):.1f}%")

    print(f"\n=== Step 18: volatility-regime filter (alpha={best_alpha}, TEST only) ===")
    for vmult in VOL_FILTER_GRID:
        das, ns = [], []
        for t, (X_test, y_test) in test_by_ticker.items():
            r = forecaster._walk_forward_backtest(
                features=X_test, targets=y_test, config=config,
                ridge_alpha_override=best_alpha, vol_filter_std_mult=vmult,
            )
            das.append(r["directional_accuracy_pct_after_vol_filter"])
            ns.append(r["samples_after_vol_filter"])
        label = "off (no filter)" if vmult is None else f"std_mult={vmult}"
        print(f"  {label:20s} TEST-set average DA = {np.mean(das):.1f}%   avg n kept = {np.mean(ns):.0f}")

    print(f"\n=== Step 17: pooled cross-ticker training (alpha={best_alpha}, TEST only) ===")
    pooled_result = forecaster._pooled_walk_forward_backtest(
        features_by_ticker={t: X for t, (X, _) in test_by_ticker.items()},
        targets_by_ticker={t: y for t, (_, y) in test_by_ticker.items()},
        config=config, ridge_alpha_override=best_alpha,
    )
    per_ticker_das = [tuned_test_das[i] for i in range(len(args.tickers))]
    for t in args.tickers:
        print(f"  {t}: per-ticker DA={tuned_test_das[args.tickers.index(t)]:.1f}%   "
              f"pooled DA={pooled_result[t]['directional_accuracy_pct']:.1f}%   n={pooled_result[t]['samples']}")
    pooled_avg = np.mean([pooled_result[t]["directional_accuracy_pct"] for t in args.tickers])
    print(f"  Average: per-ticker={np.mean(per_ticker_das):.1f}%   pooled={pooled_avg:.1f}%")

    print(f"\n=== Step 20: gradient boosting vs Ridge/logistic ensemble (TEST only) ===")
    gb_das = []
    for t, (X_test, y_test) in test_by_ticker.items():
        gb = gradient_boosting_walkforward(forecaster, X_test, y_test, config)
        gb_das.append(gb["directional_accuracy_pct"])
        print(f"  {t}: gradient boosting DA={gb['directional_accuracy_pct']:.1f}%   "
              f"(vs. tuned ridge={tuned_test_das[args.tickers.index(t)]:.1f}%)   n={gb['samples']}")
    print(f"  Average: gradient boosting={np.mean(gb_das):.1f}%   tuned ridge={np.mean(tuned_test_das):.1f}%")

    print("\nAll numbers above are from the held-out TEST split only, except where explicitly labeled TUNE.")


if __name__ == "__main__":
    main()