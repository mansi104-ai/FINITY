from __future__ import annotations

from dataclasses import dataclass
import math

import numpy as np
import pandas as pd


@dataclass
class AssetConfig:
    asset_name: str
    train_window: int
    min_train_size: int
    ridge_alpha: float
    short_cap_pct: float
    medium_cap_pct: float
    long_cap_pct: float
    scenario_multiplier: float
    query_weights: dict[str, float]


class MarketForecaster:
    ASSET_CONFIGS: dict[str, AssetConfig] = {
        "equity": AssetConfig(
            asset_name="equity",
            train_window=220,
            min_train_size=90,
            ridge_alpha=1.8,
            short_cap_pct=3.5,
            medium_cap_pct=6.5,
            long_cap_pct=12.0,
            scenario_multiplier=1.0,
            query_weights={
                "tariff": -0.18,
                "rates": -0.12,
                "inflation": -0.08,
                "earnings": 0.22,
                "guidance": 0.18,
                "growth": 0.12,
                "ai": 0.16,
                "recession": -0.2,
                "geopolitical": -0.09,
            },
        ),
        "gold": AssetConfig(
            asset_name="gold",
            train_window=260,
            min_train_size=110,
            ridge_alpha=1.4,
            short_cap_pct=1.8,
            medium_cap_pct=3.8,
            long_cap_pct=7.0,
            scenario_multiplier=0.8,
            query_weights={
                "tariff": 0.16,
                "rates": -0.12,
                "inflation": 0.2,
                "fed": -0.1,
                "safe_haven": 0.22,
                "geopolitical": 0.18,
                "usd_strength": -0.14,
                "recession": 0.14,
            },
        ),
        "oil": AssetConfig(
            asset_name="oil",
            train_window=260,
            min_train_size=110,
            ridge_alpha=1.3,
            short_cap_pct=2.2,
            medium_cap_pct=5.5,
            long_cap_pct=10.0,
            scenario_multiplier=1.25,
            query_weights={
                "tariff": -0.32,
                "trade_war": -0.28,
                "inflation": -0.04,
                "opec": 0.26,
                "inventory_draw": 0.24,
                "inventory_build": -0.24,
                "sanction": 0.16,
                "geopolitical": 0.18,
                "recession": -0.26,
                "demand_hit": -0.3,
                "usd_strength": -0.1,
            },
        ),
        "crypto": AssetConfig(
            asset_name="crypto",
            train_window=200,
            min_train_size=80,
            ridge_alpha=2.4,
            short_cap_pct=6.0,
            medium_cap_pct=12.0,
            long_cap_pct=20.0,
            scenario_multiplier=1.5,
            query_weights={
                "rates": -0.16,
                "inflation": 0.08,
                "etf": 0.24,
                "regulation": -0.22,
                "adoption": 0.2,
                "risk_on": 0.16,
                "risk_off": -0.18,
            },
        ),
        "index": AssetConfig(
            asset_name="index",
            train_window=240,
            min_train_size=100,
            ridge_alpha=1.6,
            short_cap_pct=2.4,
            medium_cap_pct=4.8,
            long_cap_pct=8.8,
            scenario_multiplier=0.9,
            query_weights={
                "tariff": -0.18,
                "rates": -0.14,
                "inflation": -0.1,
                "earnings": 0.12,
                "recession": -0.22,
                "geopolitical": -0.12,
                "risk_on": 0.14,
                "risk_off": -0.16,
            },
        ),
    }

    def predict(
        self,
        history: pd.DataFrame,
        *,
        ticker: str,
        query: str,
        sentiment_score: float,
        sentiment_level: str,
        data_source: str,
        market_history: pd.DataFrame | None = None,
    ) -> dict:
        context = self._context_profile(ticker=ticker, query=query, sentiment_score=sentiment_score)
        normalized_history = history.copy()
        normalized_history["Close"] = pd.to_numeric(normalized_history["Close"], errors="coerce")
        if "Volume" in normalized_history.columns:
            normalized_history["Volume"] = pd.to_numeric(normalized_history["Volume"], errors="coerce")
        else:
            normalized_history["Volume"] = np.nan
        normalized_history = normalized_history.dropna(subset=["Close"]).reset_index(drop=True)
        closes = normalized_history["Close"].astype(float).to_numpy()
        volumes = normalized_history["Volume"].astype(float).to_numpy()
        recent_dates = normalized_history["Date"] if "Date" in normalized_history else None
        if closes.size < 90:
            raise ValueError("Insufficient historical data for forecasting")

        # Cross-sectional market feature (Phase B step 8) -- only used if the
        # caller supplies an aligned market series (e.g. SPY) with a Date
        # column matching `history`'s. Left-joining on Date (rather than
        # assuming both frames are already the same length/order) protects
        # against silently misaligning two price series that have different
        # trading-holiday calendars or missing days -- a raw positional
        # zip would be a real lookahead/correctness bug here.
        market_closes = None
        if market_history is not None and "Date" in normalized_history.columns and "Close" in market_history.columns and "Date" in market_history.columns:
            market_norm = market_history[["Date", "Close"]].rename(columns={"Close": "MarketClose"}).copy()
            market_norm["MarketClose"] = pd.to_numeric(market_norm["MarketClose"], errors="coerce")
            merged = normalized_history[["Date"]].merge(market_norm, on="Date", how="left")
            merged["MarketClose"] = merged["MarketClose"].ffill()
            if not merged["MarketClose"].isna().all():
                market_closes = merged["MarketClose"].to_numpy()

        features, targets = self._build_training_set(closes=closes, volumes=volumes, horizon_days=context["horizon_days"], market_closes=market_closes)
        backtest = self._walk_forward_backtest(features=features, targets=targets, config=context["config"])
        train_window_features = features[-context["config"].train_window :]
        live_mean, live_std = self._standardize_fit(train_window_features)
        weights = self._fit_ridge(
            X=self._standardize_apply(train_window_features, live_mean, live_std),
            y=targets[-context["config"].train_window :],
            alpha=context["config"].ridge_alpha,
        )
        latest_features = self._latest_features(closes=closes, volumes=volumes, market_closes=market_closes)
        latest_features_scaled = self._standardize_apply(latest_features, live_mean, live_std)
        model_return_pct = float(self._predict_with_weights(weights, latest_features_scaled) * 100)
        query_adjustment_pct = self._query_adjustment_pct(context=context)
        sentiment_adjustment_pct = (sentiment_score - 0.5) * context["sentiment_scale_pct"]
        raw_return_pct = model_return_pct + query_adjustment_pct + sentiment_adjustment_pct
        predicted_return_pct = self._cap_return(raw_return_pct=raw_return_pct, horizon_days=context["horizon_days"], config=context["config"])
        context["realized_vol_pct"] = self._realized_vol_pct(closes=closes, horizon_days=context["horizon_days"])

        current_price = float(closes[-1])
        predicted_price = current_price * (1 + predicted_return_pct / 100)
        uncertainty_pct = max(backtest["mae_pct"], context["realized_vol_pct"] * context["config"].scenario_multiplier)
        confidence = self._calibrated_confidence(
            backtest=backtest,
            predicted_return_pct=predicted_return_pct,
            uncertainty_pct=uncertainty_pct,
            data_source=data_source,
        )
        trend = self._trend_label(predicted_return_pct=predicted_return_pct, uncertainty_pct=uncertainty_pct)
        support_level = float(np.min(closes[-15:]))
        resistance_level = float(np.max(closes[-15:]))
        forecast = self._generate_forecast(
            current_price=current_price,
            predicted_price=predicted_price,
            horizon_days=context["horizon_days"],
            uncertainty_pct=uncertainty_pct,
            trend=trend,
        )
        today_trend = self._today_trend(
            closes=closes,
            recent_dates=recent_dates,
            backtest=backtest,
            overall_trend=trend,
        )
        scenarios = self._build_scenarios(
            current_price=current_price,
            base_return_pct=predicted_return_pct,
            uncertainty_pct=uncertainty_pct,
            context=context,
        )

        return {
            "ticker": ticker,
            "currentPrice": round(current_price, 2),
            "predictedPrice": round(predicted_price, 2),
            "predictedReturnPct": round(predicted_return_pct, 2),
            "confidence": round(confidence, 2),
            "trend": trend,
            "volatilityBandPct": round(uncertainty_pct, 2),
            "supportLevel": round(support_level, 2),
            "resistanceLevel": round(resistance_level, 2),
            "todayTrend": today_trend,
            "horizonLabel": context["horizon_label"],
            "queryAlignment": round(context["alignment"], 2),
            "predictionMethod": f"{context['asset_label']} rolling regression forecast with macro overlays",
            "methodFactors": [
                f"Used {data_source} daily historical market data.",
                f"Applied the {context['asset_label']} asset model for a {context['horizon_label']} horizon.",
                f"Blended market features, query macro/event flags, and researcher sentiment.",
                (
                    f"Backtest over {backtest['samples']} samples: hit rate {backtest['directional_accuracy_pct']:.1f}%, "
                    f"MAE {backtest['mae_pct']:.2f}%."
                ),
            ],
            "backtest": {
                "samples": backtest["samples"],
                "maePct": round(backtest["mae_pct"], 2),
                "rmsePct": round(backtest["rmse_pct"], 2),
                "directionalAccuracyPct": round(backtest["directional_accuracy_pct"], 2),
                "directionalAccuracyEnsemblePct": round(backtest.get("directional_accuracy_ensemble_pct", backtest["directional_accuracy_pct"]), 2),
            },
            "analystSummary": self._summary(
                predicted_return_pct=predicted_return_pct,
                confidence=confidence,
                uncertainty_pct=uncertainty_pct,
                context=context,
                data_source=data_source,
            ),
            "signals": self._signals(
                latest_features=latest_features,
                context=context,
                sentiment_level=sentiment_level,
                model_return_pct=model_return_pct,
                query_adjustment_pct=query_adjustment_pct,
                support_level=support_level,
                resistance_level=resistance_level,
            ),
            "scenarios": scenarios,
            "history": [round(float(value), 2) for value in closes[-40:]],
            "forecast": forecast,
        }

    def _context_profile(self, *, ticker: str, query: str, sentiment_score: float) -> dict:
        text = f"{ticker} {query}".lower()
        horizon_days = 5
        horizon_label = "5 trading days"
        if any(term in text for term in {"today", "intraday", "right now", "by close"}):
            horizon_days = 1
            horizon_label = "today"
        elif any(term in text for term in {"tomorrow", "next session"}):
            horizon_days = 2
            horizon_label = "next 1-2 sessions"
        elif any(term in text for term in {"this week", "next week", "weekly"}):
            horizon_days = 5
            horizon_label = "1 trading week"
        elif any(term in text for term in {"this month", "next month", "30 days"}):
            horizon_days = 20
            horizon_label = "1 trading month"

        asset_type = "equity"
        asset_label = "Equity"
        if any(term in text for term in {"gold", "xau", "gld"}):
            asset_type = "gold"
            asset_label = "Gold"
        elif any(term in text for term in {"oil", "crude", "brent", "wti"}):
            asset_type = "oil"
            asset_label = "Crude Oil"
        elif any(term in text for term in {"btc", "bitcoin", "eth", "ethereum", "crypto"}):
            asset_type = "crypto"
            asset_label = "Crypto"
        elif any(term in text for term in {"spy", "qqq", "index", "nasdaq", "s&p", "dow"}):
            asset_type = "index"
            asset_label = "Index"

        query_flags = self._extract_query_flags(text=text)
        query_bias = sum(self.ASSET_CONFIGS[asset_type].query_weights.get(flag, 0.0) for flag, active in query_flags.items() if active)
        sentiment_scale_pct = 1.1 if asset_type in {"equity", "index"} else 0.7
        alignment = min(0.98, 0.42 + abs(query_bias) * 0.8 + (0.08 if query.strip() else 0.0) + abs(sentiment_score - 0.5) * 0.5)

        return {
            "asset_type": asset_type,
            "asset_label": asset_label,
            "config": self.ASSET_CONFIGS[asset_type],
            "horizon_days": horizon_days,
            "horizon_label": horizon_label,
            "query_flags": query_flags,
            "query_bias_pct": query_bias,
            "alignment": alignment,
            "sentiment_scale_pct": sentiment_scale_pct,
            "realized_vol_pct": 0.0,
        }

    def _extract_query_flags(self, *, text: str) -> dict[str, bool]:
        return {
            "tariff": any(term in text for term in {"tariff", "tariffs", "import duty", "duties"}),
            "trade_war": any(term in text for term in {"trade war", "trade tensions", "sanction", "sanctions"}),
            "rates": any(term in text for term in {"rates", "yield", "treasury", "bond yields"}),
            "inflation": any(term in text for term in {"inflation", "cpi", "ppi"}),
            "fed": any(term in text for term in {"fed", "fomc", "central bank"}),
            "opec": any(term in text for term in {"opec", "production cut", "output cut"}),
            "inventory_draw": any(term in text for term in {"inventory draw", "stock draw", "drawdown in inventories"}),
            "inventory_build": any(term in text for term in {"inventory build", "stock build", "build in inventories"}),
            "earnings": any(term in text for term in {"earnings", "results", "quarterly"}),
            "guidance": any(term in text for term in {"guidance", "outlook"}),
            "growth": any(term in text for term in {"growth", "revenue", "margin", "demand"}),
            "ai": "ai" in text,
            "safe_haven": any(term in text for term in {"safe haven", "risk-off", "geopolitical"}),
            "geopolitical": any(term in text for term in {"war", "conflict", "geopolitical", "middle east"}),
            "recession": "recession" in text,
            "usd_strength": any(term in text for term in {"strong dollar", "usd strength", "dollar strength"}),
            "demand_hit": any(term in text for term in {"demand hit", "weaker demand", "slowdown"}),
            "etf": "etf" in text,
            "regulation": any(term in text for term in {"regulation", "regulatory", "sec"}),
            "adoption": any(term in text for term in {"adoption", "adopt", "institutional inflow"}),
            "risk_on": "risk-on" in text,
            "risk_off": "risk-off" in text,
        }

    def _build_training_set(self, *, closes: np.ndarray, volumes: np.ndarray, horizon_days: int, market_closes: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
        rows: list[np.ndarray] = []
        targets: list[float] = []
        for idx in range(30, len(closes) - horizon_days):
            history = closes[: idx + 1]
            vol_history = volumes[: idx + 1]
            market_history = market_closes[: idx + 1] if market_closes is not None else None
            rows.append(self._feature_vector(history, vol_history, market_history))
            future_return = closes[idx + horizon_days] / max(closes[idx], 1e-9) - 1
            targets.append(float(future_return))
        return np.vstack(rows), np.array(targets)

    def _latest_features(self, *, closes: np.ndarray, volumes: np.ndarray, market_closes: np.ndarray | None = None) -> np.ndarray:
        return self._feature_vector(closes, volumes, market_closes)

    @staticmethod
    def _ema(values: np.ndarray, span: int) -> np.ndarray:
        """Standard exponential moving average, seeded with a simple mean
        of the first `span` values (common convention; avoids the EMA
        being dominated by whatever the first single price happened to be)."""
        alpha = 2.0 / (span + 1.0)
        ema = np.empty_like(values, dtype=float)
        seed_n = min(span, len(values))
        ema[: seed_n] = np.mean(values[:seed_n])
        for i in range(seed_n, len(values)):
            ema[i] = alpha * values[i] + (1 - alpha) * ema[i - 1]
        return ema

    def _macd_histogram_feature(self, closes: np.ndarray) -> float:
        """
        MACD (12/26 EMA) minus its 9-day signal line, i.e. the MACD
        histogram -- positive means bullish momentum accelerating,
        negative means it's decelerating/turning. Normalized by price so
        it's comparable in scale to the return-based features rather than
        being in raw dollars.
        Needs >= 26 closes to be meaningful; returns 0.0 (neutral) below
        that, same convention as the other features' warm-up guards.
        """
        window = closes[-100:]  # cap history fed into EMA for speed; 100 days is plenty for 12/26/9 to converge
        if window.size < 26:
            return 0.0
        ema12 = self._ema(window, 12)
        ema26 = self._ema(window, 26)
        macd_line = ema12 - ema26
        signal_line = self._ema(macd_line, 9)
        histogram = macd_line[-1] - signal_line[-1]
        return float(np.clip(histogram / max(float(window[-1]), 1e-9), -0.1, 0.1)) * 10  # scale to roughly [-1, 1]

    def _bollinger_position_feature(self, closes: np.ndarray, window: int = 20, n_std: float = 2.0) -> float:
        """
        %B: where the current price sits relative to its Bollinger Bands,
        rescaled to roughly [-1, 1] (0 = at the middle/moving-average
        band, +1 = at the upper band, -1 = at the lower band, and it can
        exceed +-1 when price is outside the bands entirely). Standard
        mean-reversion signal that complements RSI rather than duplicating
        it -- RSI here is a 14-day gain/loss ratio, this is a
        volatility-scaled distance from a 20-day mean.
        """
        recent = closes[-window:]
        if recent.size < window:
            return 0.0
        mid = float(np.mean(recent))
        std = float(np.std(recent))
        if std < 1e-9:
            return 0.0
        upper = mid + n_std * std
        lower = mid - n_std * std
        pct_b = (float(closes[-1]) - mid) / max((upper - lower) / 2.0, 1e-9)
        return float(np.clip(pct_b, -2.0, 2.0))

    def _market_momentum_feature(self, closes: np.ndarray, market_closes: np.ndarray | None) -> float:
        """
        Cross-sectional feature (Phase A step 3 / Phase B step 8): this
        ticker's 5-day return MINUS the market's (e.g. SPY) 5-day return
        over the same window -- i.e. relative strength vs. the market,
        not just the ticker's own momentum (which features 1-4 already
        capture). Requires market_closes aligned index-for-index with
        `closes` (same trading days, same array length as of `closes`'
        current cutoff) -- callers are responsible for that alignment
        (see eval_analyst.py's date-merge against SPY.csv for the
        reference implementation). Returns 0.0 (neutral) if no market
        series was supplied, so this feature is fully backward-compatible
        for any caller that doesn't have market data available.
        """
        if market_closes is None or len(market_closes) != len(closes) or len(closes) < 6:
            return 0.0
        ticker_ret5 = float(closes[-1] / max(float(closes[-6]), 1e-9) - 1)
        market_ret5 = float(market_closes[-1] / max(float(market_closes[-6]), 1e-9) - 1)
        return float(np.clip(ticker_ret5 - market_ret5, -0.5, 0.5))

    def _feature_vector(self, closes: np.ndarray, volumes: np.ndarray | None = None, market_closes: np.ndarray | None = None) -> np.ndarray:
        daily_returns = np.diff(closes[-21:]) / np.maximum(closes[-21:-1], 1e-9)
        gains = np.clip(daily_returns, 0, None)
        losses = -np.clip(daily_returns, None, 0)
        avg_gain = float(np.mean(gains[-14:])) if gains.size else 0.0
        avg_loss = float(np.mean(losses[-14:])) if losses.size else 0.0
        rs = avg_gain / max(avg_loss, 1e-9)
        rsi = 100 - (100 / (1 + rs))

        last_price = float(closes[-1])
        max20 = float(np.max(closes[-20:]))
        min20 = float(np.min(closes[-20:]))

        # Volume feature (paper Eq. 3: V_t / V-bar). Falls back to neutral (0.0)
        # if volume data wasn't available for this source (e.g. some CSV
        # exports or synthetic fallback data lack it) -- keeps the feature
        # vector length constant either way so old and new callers both work.
        volume_feature = 0.0
        if volumes is not None and len(volumes) >= 20:
            recent_vol = volumes[-20:]
            if not np.any(np.isnan(recent_vol)) and np.mean(recent_vol) > 0:
                vol_ratio = float(recent_vol[-1] / max(float(np.mean(recent_vol)), 1e-9))
                # log-scale and center so typical ratios (~0.5x-2x average) map
                # to a roughly [-1, 1] range like the other features
                volume_feature = float(np.clip(np.log(max(vol_ratio, 1e-6)), -1.5, 1.5))

        return np.array(
            [
                1.0,
                last_price / max(float(closes[-2]), 1e-9) - 1,
                last_price / max(float(closes[-6]), 1e-9) - 1,
                last_price / max(float(closes[-11]), 1e-9) - 1,
                last_price / max(float(closes[-21]), 1e-9) - 1,
                float(np.std(daily_returns[-5:])) if daily_returns.size >= 5 else 0.0,
                float(np.std(daily_returns[-10:])) if daily_returns.size >= 10 else 0.0,
                last_price / max(float(np.mean(closes[-10:])), 1e-9) - 1,
                last_price / max(float(np.mean(closes[-20:])), 1e-9) - 1,
                last_price / max(max20, 1e-9) - 1,
                (last_price - min20) / max(max20 - min20, 1e-9) - 0.5,
                (rsi - 50) / 50,
                volume_feature,
                self._macd_histogram_feature(closes),
                self._bollinger_position_feature(closes),
                self._market_momentum_feature(closes, market_closes),
            ],
            dtype=float,
        )

    def _standardize_fit(self, X: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """
        Computes per-feature mean/std from a training window, EXCLUDING
        the bias column (col 0, always 1.0 -- standardizing it would
        divide by zero and destroy the intercept). Returns (mean, std)
        with a std floor so a constant/near-constant feature in a given
        window doesn't blow up. Fit once per training window and reused
        for both the Ridge fit and the classifier fit on that same
        window (Phase B step 11) -- previously the classifier silently
        did its own separate ad hoc scaling internally while Ridge used
        raw features, so the two models were never regularized on a
        comparable footing even though they trained on the same data.
        """
        mean = np.zeros(X.shape[1])
        std = np.ones(X.shape[1])
        mean[1:] = np.mean(X[:, 1:], axis=0)
        col_std = np.std(X[:, 1:], axis=0)
        col_std[col_std < 1e-9] = 1.0
        std[1:] = col_std
        return mean, std

    def _standardize_apply(self, X: np.ndarray, mean: np.ndarray, std: np.ndarray, clip_z: float = 4.0) -> np.ndarray:
        """
        Standardizes, then winsorizes to +-clip_z standard deviations
        (Phase B step 10). Clipping happens AFTER scaling and uses only
        `mean`/`std` computed from the training window passed to
        _standardize_fit -- never a global/full-history statistic -- so
        an outlier day (e.g. a large earnings-gap move) occurring inside
        one rolling window can't be dampened using information from
        outside that window, which would be a lookahead leak. +-4 std is
        deliberately loose: it's meant to blunt the single most extreme
        days per window (e.g. the earnings-gap dates data_audit.py
        flagged for NVDA/TSLA in Phase A), not to compress normal
        day-to-day variation.
        """
        out = X.copy()
        out[..., 1:] = np.clip((X[..., 1:] - mean[1:]) / std[1:], -clip_z, clip_z)
        return out

    def _fit_ridge(self, *, X: np.ndarray, y: np.ndarray, alpha: float) -> np.ndarray:
        xtx = X.T @ X
        regularizer = np.eye(xtx.shape[0]) * alpha
        regularizer[0, 0] = 0.0
        return np.linalg.pinv(xtx + regularizer) @ X.T @ y

    def _fit_logistic(self, *, X: np.ndarray, y: np.ndarray, l2: float = 1.0, lr: float = 0.15, epochs: int = 300) -> np.ndarray:
        """
        Lightweight numpy-only logistic regression trained directly on
        direction (up/down), rather than on return magnitude. A regressor
        minimizing squared error on magnitude is optimizing a different
        objective than "get the sign right" -- this gives the walk-forward
        backtest a second, purpose-built signal for the directional-accuracy
        metric specifically.

        NOTE (Phase B step 11): this function now assumes X arrives
        ALREADY standardized by the caller via _standardize_fit /
        _standardize_apply, using the same per-window stats given to
        _fit_ridge -- it no longer does its own separate internal scaling.
        Callers must standardize both X_train and the point they'll later
        score with these weights using the identical (mean, std).
        """
        n, d = X.shape
        weights = np.zeros(d)
        y_binary = (y > 0).astype(float)
        for _ in range(epochs):
            z = np.clip(X @ weights, -30, 30)
            p = 1.0 / (1.0 + np.exp(-z))
            grad = X.T @ (p - y_binary) / n
            grad[1:] += l2 * weights[1:] / n
            weights -= lr * grad
        return weights

    def _logistic_prob(self, weights: np.ndarray, features: np.ndarray) -> float:
        z = float(np.clip(features @ weights, -30, 30))
        return 1.0 / (1.0 + math.exp(-z))

    def _realized_vol_pct(self, *, closes: np.ndarray, horizon_days: int) -> float:
        returns = np.diff(closes[-40:]) / np.maximum(closes[-40:-1], 1e-9)
        if returns.size == 0:
            return 1.0
        daily_vol = float(np.std(returns) * 100)
        return daily_vol * max(math.sqrt(max(horizon_days, 1)), 1.0)

    def _predict_with_weights(self, weights: np.ndarray, features: np.ndarray) -> float:
        return float(features @ weights)

    def _walk_forward_backtest(
        self,
        *,
        features: np.ndarray,
        targets: np.ndarray,
        config: AssetConfig,
        window_mode: str = "rolling",
        ridge_alpha_override: float | None = None,
        classifier_l2_override: float | None = None,
        vol_filter_std_mult: float | None = None,
    ) -> dict[str, float]:
        """
        window_mode: "rolling" (default, unchanged behavior) trains on the
            trailing `config.train_window` samples. "expanding" (step 19)
            trains on everything seen so far from the start of the series,
            growing every step -- more data per fit, but training-set
            "recency" to the current regime is lost as the window grows.
        ridge_alpha_override / classifier_l2_override (steps 13/14): lets
            a grid-search caller sweep hyperparameters without needing to
            mutate the shared AssetConfig objects other code reads from.
        vol_filter_std_mult (step 18): if set, a day is treated as
            "extreme-vol" and excluded from the *_after_vol_filter metrics
            when its 10-day realized vol (feature index 6) exceeds
            `mean + vol_filter_std_mult * std` of that SAME quantity
            computed ONLY from the current training window -- never from
            future data, so this can't leak. The unfiltered metrics are
            always still returned too, so filtering-on vs filtering-off
            can be compared directly.
        """
        alpha = ridge_alpha_override if ridge_alpha_override is not None else config.ridge_alpha
        clf_l2 = classifier_l2_override if classifier_l2_override is not None else 1.0

        preds: list[float] = []
        actuals: list[float] = []
        ensemble_hits: list[bool] = []
        is_high_vol: list[bool] = []
        start = max(config.min_train_size, len(features) - 120)
        for idx in range(start, len(features)):
            train_start = 0 if window_mode == "expanding" else max(0, idx - config.train_window)
            X_train = features[train_start:idx]
            y_train = targets[train_start:idx]
            if len(X_train) < config.min_train_size:
                continue
            mean, std = self._standardize_fit(X_train)
            X_train_scaled = self._standardize_apply(X_train, mean, std)
            point_scaled = self._standardize_apply(features[idx], mean, std)

            weights = self._fit_ridge(X=X_train_scaled, y=y_train, alpha=alpha)
            ridge_pred = self._predict_with_weights(weights, point_scaled)
            preds.append(ridge_pred)
            actuals.append(float(targets[idx]))

            vol_col = X_train[:, 6]  # std_ret_10d, raw (unstandardized) units
            vol_mean, vol_std = float(np.mean(vol_col)), float(np.std(vol_col))
            current_vol = float(features[idx, 6])
            high_vol = (
                vol_filter_std_mult is not None and vol_std > 1e-9
                and current_vol > vol_mean + vol_filter_std_mult * vol_std
            )
            is_high_vol.append(high_vol)

            # Ensemble direction: classifier trained on the same rolling window
            # (same standardization stats as Ridge -- step 11), purpose-built for
            # sign prediction. The classifier is a weaker learner than Ridge on
            # its own (measured: it dragged average directional accuracy BELOW
            # Ridge when allowed to override freely), so it is used ONLY as a
            # tie-breaker: it may flip the call away from Ridge just when Ridge is
            # near its OWN decision boundary (a small-magnitude prediction, i.e.
            # low Ridge conviction) AND the classifier is genuinely confident.
            # When Ridge predicts a sizeable move it is trusted outright. This
            # confines the weak learner's influence to exactly the cases where
            # Ridge has no conviction, so the ensemble can improve on Ridge in
            # the coin-flip zone without degrading it where Ridge is decisive.
            clf_weights = self._fit_logistic(X=X_train_scaled, y=y_train, l2=clf_l2)
            prob_up = self._logistic_prob(clf_weights, point_scaled)
            ridge_sign = 1 if ridge_pred >= 0 else -1
            ridge_tie_threshold = 0.3 * float(np.median(np.abs(y_train))) if len(y_train) else 0.0
            ridge_uncertain = abs(ridge_pred) < ridge_tie_threshold
            if ridge_uncertain and prob_up >= 0.60:
                ensemble_sign = 1
            elif ridge_uncertain and prob_up <= 0.40:
                ensemble_sign = -1
            else:
                ensemble_sign = ridge_sign
            actual_sign = 1 if targets[idx] >= 0 else -1
            ensemble_hits.append(ensemble_sign == actual_sign)

        if not preds:
            return {
                "samples": 0, "mae_pct": 2.5, "rmse_pct": 3.2,
                "directional_accuracy_pct": 50.0,
                "directional_accuracy_ensemble_pct": 50.0,
                "samples_after_vol_filter": 0,
                "directional_accuracy_pct_after_vol_filter": 50.0,
            }

        pred_arr = np.array(preds)
        actual_arr = np.array(actuals)
        vol_mask = ~np.array(is_high_vol)  # True = keep (normal-vol day)
        abs_errors = np.abs(pred_arr - actual_arr) * 100
        sq_errors = np.square(pred_arr - actual_arr) * 10000
        directional_hits = np.mean(np.sign(pred_arr) == np.sign(actual_arr)) * 100
        ensemble_accuracy = float(np.mean(ensemble_hits) * 100) if ensemble_hits else directional_hits

        if vol_filter_std_mult is not None and vol_mask.sum() > 0:
            da_filtered = float(np.mean(np.sign(pred_arr[vol_mask]) == np.sign(actual_arr[vol_mask])) * 100)
            n_filtered = int(vol_mask.sum())
        else:
            da_filtered = directional_hits
            n_filtered = len(preds)
        return {
            "samples": float(len(preds)),
            "mae_pct": float(np.mean(abs_errors)),
            "rmse_pct": float(np.sqrt(np.mean(sq_errors))),
            "directional_accuracy_pct": float(directional_hits),
            "directional_accuracy_ensemble_pct": ensemble_accuracy,
            "samples_after_vol_filter": n_filtered,
            "directional_accuracy_pct_after_vol_filter": da_filtered,
        }

    def _pooled_walk_forward_backtest(
        self,
        *,
        features_by_ticker: dict[str, np.ndarray],
        targets_by_ticker: dict[str, np.ndarray],
        config: AssetConfig,
        window_mode: str = "rolling",
        ridge_alpha_override: float | None = None,
        classifier_l2_override: float | None = None,
    ) -> dict[str, dict]:
        """
        Step 17: at each walk-forward step, fits ONE Ridge + ONE classifier
        on the pooled training rows from ALL tickers in the same date
        window (more effective samples per fit than any single ticker's
        own history alone), then scores every ticker's held-out point for
        that date using that shared fit. Requires every ticker's feature
        array to be the same length and index-aligned by trading day
        (true for tickers pulled over the same period/date range here) --
        if lengths differ this raises rather than silently truncating,
        since silent misalignment would make "pooled" mean something
        different per ticker without anyone noticing.
        """
        lengths = {t: len(f) for t, f in features_by_ticker.items()}
        if len(set(lengths.values())) > 1:
            raise ValueError(f"Pooled training requires aligned feature arrays; got different lengths: {lengths}")
        n = next(iter(lengths.values()))
        tickers = list(features_by_ticker.keys())

        preds_by_ticker = {t: [] for t in tickers}
        actuals_by_ticker = {t: [] for t in tickers}
        alpha = ridge_alpha_override if ridge_alpha_override is not None else config.ridge_alpha
        clf_l2 = classifier_l2_override if classifier_l2_override is not None else 1.0

        start = max(config.min_train_size, n - 120)
        for idx in range(start, n):
            train_start = 0 if window_mode == "expanding" else max(0, idx - config.train_window)
            X_train_pool = np.vstack([features_by_ticker[t][train_start:idx] for t in tickers])
            y_train_pool = np.concatenate([targets_by_ticker[t][train_start:idx] for t in tickers])
            if len(X_train_pool) < config.min_train_size:
                continue
            mean, std = self._standardize_fit(X_train_pool)
            X_train_scaled = self._standardize_apply(X_train_pool, mean, std)
            weights = self._fit_ridge(X=X_train_scaled, y=y_train_pool, alpha=alpha)

            for t in tickers:
                point_scaled = self._standardize_apply(features_by_ticker[t][idx], mean, std)
                pred = self._predict_with_weights(weights, point_scaled)
                preds_by_ticker[t].append(pred)
                actuals_by_ticker[t].append(float(targets_by_ticker[t][idx]))

        results = {}
        for t in tickers:
            p, a = np.array(preds_by_ticker[t]), np.array(actuals_by_ticker[t])
            if len(p) == 0:
                results[t] = {"samples": 0, "directional_accuracy_pct": 50.0, "mae_pct": 2.5}
                continue
            da = float(np.mean(np.sign(p) == np.sign(a)) * 100)
            mae = float(np.mean(np.abs(p - a)) * 100)
            results[t] = {"samples": len(p), "directional_accuracy_pct": da, "mae_pct": mae}
        return results

    def _query_adjustment_pct(self, *, context: dict) -> float:
        adjustment = context["query_bias_pct"]
        if context["asset_type"] == "oil" and context["query_flags"]["tariff"] and context["horizon_days"] <= 2:
            adjustment -= 0.18
        if context["asset_type"] == "gold" and context["query_flags"]["safe_haven"]:
            adjustment += 0.08
        return adjustment

    def _cap_return(self, *, raw_return_pct: float, horizon_days: int, config: AssetConfig) -> float:
        if horizon_days <= 2:
            cap = config.short_cap_pct
        elif horizon_days <= 7:
            cap = config.medium_cap_pct
        else:
            cap = config.long_cap_pct
        return float(np.clip(raw_return_pct, -cap, cap))

    def _calibrated_confidence(self, *, backtest: dict[str, float], predicted_return_pct: float, uncertainty_pct: float, data_source: str) -> float:
        hit_rate = backtest["directional_accuracy_pct"] / 100
        mae_component = max(0.0, 1 - backtest["mae_pct"] / max(uncertainty_pct * 1.5, 0.5))
        signal_component = min(abs(predicted_return_pct) / max(uncertainty_pct, 0.25), 1.0)
        data_quality = 1.0 if data_source == "yfinance" else 0.72
        confidence = 0.22 + hit_rate * 0.4 + mae_component * 0.23 + signal_component * 0.15
        return float(np.clip(confidence * data_quality, 0.28, 0.9))

    def _trend_label(self, *, predicted_return_pct: float, uncertainty_pct: float) -> str:
        threshold = max(0.35, uncertainty_pct * 0.45)
        if predicted_return_pct > threshold:
            return "bullish"
        if predicted_return_pct < -threshold:
            return "bearish"
        return "sideways"

    def _today_tape_trend_label(self, *, projected_move_pct: float, recent_vol_pct: float) -> str:
        threshold = max(0.12, recent_vol_pct * 0.28)
        if projected_move_pct > threshold:
            return "up"
        if projected_move_pct < -threshold:
            return "down"
        return "flat"

    def _today_trend(
        self,
        *,
        closes: np.ndarray,
        recent_dates: pd.Series | None,
        backtest: dict[str, float],
        overall_trend: str,
    ) -> dict:
        lookback = int(min(5, max(len(closes) - 1, 1)))
        recent_closes = closes[-(lookback + 1) :]
        recent_returns = np.diff(recent_closes) / np.maximum(recent_closes[:-1], 1e-9)
        short_momentum_pct = float((recent_closes[-1] / max(recent_closes[-3], 1e-9) - 1) * 100) if len(recent_closes) >= 3 else 0.0
        medium_momentum_pct = float((recent_closes[-1] / max(recent_closes[0], 1e-9) - 1) * 100)
        drift_pct = float(np.mean(recent_returns) * 100) if recent_returns.size else 0.0
        projected_move_pct = short_momentum_pct * 0.45 + medium_momentum_pct * 0.35 + drift_pct * 0.2
        recent_vol_pct = float(np.std(recent_returns) * 100) if recent_returns.size else 0.0
        direction = self._today_tape_trend_label(projected_move_pct=projected_move_pct, recent_vol_pct=recent_vol_pct)

        directional_accuracy = backtest["directional_accuracy_pct"] / 100
        momentum_consistency = float(np.mean(np.sign(recent_returns) == np.sign(np.mean(recent_returns)))) if recent_returns.size else 0.5
        agreement_bonus = 0.08 if (
            (overall_trend == "bullish" and direction == "up")
            or (overall_trend == "bearish" and direction == "down")
            or (overall_trend == "sideways" and direction == "flat")
        ) else 0.0
        confidence = np.clip(0.34 + directional_accuracy * 0.32 + momentum_consistency * 0.22 + agreement_bonus, 0.3, 0.9)

        last_session_date = None
        if recent_dates is not None and not recent_dates.empty:
            last_value = pd.to_datetime(recent_dates.iloc[-1], errors="coerce")
            if pd.notna(last_value):
                last_session_date = last_value.strftime("%Y-%m-%d")

        return {
            "direction": direction,
            "projectedMovePct": round(float(projected_move_pct), 2),
            "confidence": round(float(confidence), 2),
            "basedOnDays": lookback,
            "lastSessionDate": last_session_date,
            "method": "Short-window tape trend using the last few daily closes only.",
        }

    def _generate_forecast(self, *, current_price: float, predicted_price: float, horizon_days: int, uncertainty_pct: float, trend: str) -> list[float]:
        steps = max(4, min(8, horizon_days + 3))
        total_move = predicted_price - current_price
        wave_scale = current_price * (uncertainty_pct / 100) * 0.18
        trend_sign = 1 if trend == "bullish" else -1 if trend == "bearish" else 0
        curve: list[float] = []
        for idx in range(steps):
            progress = (idx + 1) / steps
            ease = 1 - pow(1 - progress, 1.4)
            path = current_price + total_move * ease
            wave = math.sin(progress * math.pi * 1.5) * wave_scale * trend_sign
            recoil = math.sin(progress * math.pi * 2.6) * wave_scale * 0.35
            curve.append(round(max(1.0, path + wave + recoil), 2))
        curve[-1] = round(predicted_price, 2)
        return curve

    def _build_scenarios(self, *, current_price: float, base_return_pct: float, uncertainty_pct: float, context: dict) -> list[dict]:
        spread = max(uncertainty_pct * 0.8, 0.25)
        bull_return = base_return_pct + spread
        bear_return = base_return_pct - spread

        if context["asset_type"] == "oil" and context["query_flags"]["tariff"]:
            bull_reason = "Supply-side tightness offsets tariff-related demand weakness."
            bear_reason = "Tariff pressure reduces growth expectations and crude demand."
        elif context["asset_type"] == "gold":
            bull_reason = "Risk-off or inflation pressure keeps safe-haven demand elevated."
            bear_reason = "Real yields and dollar strength cap upside."
        elif context["asset_type"] == "equity":
            bull_reason = "Risk appetite and company-specific momentum support follow-through."
            bear_reason = "Macro pressure or softer guidance weighs on the tape."
        elif context["asset_type"] == "crypto":
            bull_reason = "Flow momentum and risk-on positioning extend the move."
            bear_reason = "Volatility or regulatory pressure hits risk appetite."
        else:
            bull_reason = "Broad risk appetite improves market tone."
            bear_reason = "Macro pressure weighs on index breadth."

        scenarios = [
            ("Bull case", bull_return, bull_reason),
            ("Base case", base_return_pct, f"Most likely path over {context['horizon_label']} given the fitted model."),
            ("Bear case", bear_return, bear_reason),
        ]
        return [
            {
                "label": label,
                "price": round(float(current_price * (1 + return_pct / 100)), 2),
                "returnPct": round(float(return_pct), 2),
                "reason": reason,
            }
            for label, return_pct, reason in scenarios
        ]

    def _summary(self, *, predicted_return_pct: float, confidence: float, uncertainty_pct: float, context: dict, data_source: str) -> str:
        direction = "upside" if predicted_return_pct > 0.15 else "downside" if predicted_return_pct < -0.15 else "range-bound"
        return (
            f"{context['asset_label']} model projects {direction} over {context['horizon_label']} with an expected move of "
            f"{predicted_return_pct:.2f}% and calibrated confidence of {confidence * 100:.0f}%. "
            f"Backtest-calibrated uncertainty is +/-{uncertainty_pct:.2f}% using {data_source} history."
        )

    def _signals(
        self,
        *,
        latest_features: np.ndarray,
        context: dict,
        sentiment_level: str,
        model_return_pct: float,
        query_adjustment_pct: float,
        support_level: float,
        resistance_level: float,
    ) -> list[str]:
        signals = [
            f"Market model contribution: {model_return_pct:.2f}%.",
            f"Query/macro overlay contribution: {query_adjustment_pct:.2f}%.",
            f"Research sentiment currently reads {sentiment_level}.",
            f"Latest 20-day momentum is {latest_features[4] * 100:.2f}% with RSI bias {latest_features[11] * 50 + 50:.0f}.",
            f"Support sits near {support_level:.2f} and resistance near {resistance_level:.2f}.",
        ]
        return signals