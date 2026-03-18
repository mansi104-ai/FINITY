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
    ) -> dict:
        context = self._context_profile(ticker=ticker, query=query, sentiment_score=sentiment_score)
        normalized_history = history.copy()
        normalized_history["Close"] = pd.to_numeric(normalized_history["Close"], errors="coerce")
        normalized_history = normalized_history.dropna(subset=["Close"]).reset_index(drop=True)
        closes = normalized_history["Close"].astype(float).to_numpy()
        recent_dates = normalized_history["Date"] if "Date" in normalized_history else None
        if closes.size < 90:
            raise ValueError("Insufficient historical data for forecasting")

        features, targets = self._build_training_set(closes=closes, horizon_days=context["horizon_days"])
        backtest = self._walk_forward_backtest(features=features, targets=targets, config=context["config"])
        weights = self._fit_ridge(
            X=features[-context["config"].train_window :],
            y=targets[-context["config"].train_window :],
            alpha=context["config"].ridge_alpha,
        )
        latest_features = self._latest_features(closes=closes)
        model_return_pct = float(self._predict_with_weights(weights, latest_features) * 100)
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

    def _build_training_set(self, *, closes: np.ndarray, horizon_days: int) -> tuple[np.ndarray, np.ndarray]:
        rows: list[np.ndarray] = []
        targets: list[float] = []
        for idx in range(30, len(closes) - horizon_days):
            history = closes[: idx + 1]
            rows.append(self._feature_vector(history))
            future_return = closes[idx + horizon_days] / max(closes[idx], 1e-9) - 1
            targets.append(float(future_return))
        return np.vstack(rows), np.array(targets)

    def _latest_features(self, *, closes: np.ndarray) -> np.ndarray:
        return self._feature_vector(closes)

    def _feature_vector(self, closes: np.ndarray) -> np.ndarray:
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
            ],
            dtype=float,
        )

    def _fit_ridge(self, *, X: np.ndarray, y: np.ndarray, alpha: float) -> np.ndarray:
        xtx = X.T @ X
        regularizer = np.eye(xtx.shape[0]) * alpha
        regularizer[0, 0] = 0.0
        return np.linalg.pinv(xtx + regularizer) @ X.T @ y

    def _realized_vol_pct(self, *, closes: np.ndarray, horizon_days: int) -> float:
        returns = np.diff(closes[-40:]) / np.maximum(closes[-40:-1], 1e-9)
        if returns.size == 0:
            return 1.0
        daily_vol = float(np.std(returns) * 100)
        return daily_vol * max(math.sqrt(max(horizon_days, 1)), 1.0)

    def _predict_with_weights(self, weights: np.ndarray, features: np.ndarray) -> float:
        return float(features @ weights)

    def _walk_forward_backtest(self, *, features: np.ndarray, targets: np.ndarray, config: AssetConfig) -> dict[str, float]:
        preds: list[float] = []
        actuals: list[float] = []
        start = max(config.min_train_size, len(features) - 120)
        for idx in range(start, len(features)):
            train_start = max(0, idx - config.train_window)
            X_train = features[train_start:idx]
            y_train = targets[train_start:idx]
            if len(X_train) < config.min_train_size:
                continue
            weights = self._fit_ridge(X=X_train, y=y_train, alpha=config.ridge_alpha)
            preds.append(self._predict_with_weights(weights, features[idx]))
            actuals.append(float(targets[idx]))

        if not preds:
            return {"samples": 0, "mae_pct": 2.5, "rmse_pct": 3.2, "directional_accuracy_pct": 50.0}

        pred_arr = np.array(preds)
        actual_arr = np.array(actuals)
        abs_errors = np.abs(pred_arr - actual_arr) * 100
        sq_errors = np.square(pred_arr - actual_arr) * 10000
        directional_hits = np.mean(np.sign(pred_arr) == np.sign(actual_arr)) * 100
        return {
            "samples": float(len(preds)),
            "mae_pct": float(np.mean(abs_errors)),
            "rmse_pct": float(np.sqrt(np.mean(sq_errors))),
            "directional_accuracy_pct": float(directional_hits),
        }

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
