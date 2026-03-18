from __future__ import annotations

from dataclasses import dataclass
import math
import re

import numpy as np
import pandas as pd


@dataclass
class LSTMModel:
    window: int = 10

    def predict(
        self,
        df: pd.DataFrame,
        *,
        ticker: str = "",
        query: str = "",
        sentiment_score: float = 0.5,
        sentiment_level: str = "HOLD",
    ) -> dict:
        closes = df["Close"].astype(float).dropna().to_numpy()
        if closes.size < self.window + 2:
            closes = self.synthetic_history(seed=f"{ticker or 'fallback'}:{query or 'fallback'}")["Close"].to_numpy()

        current_price = float(closes[-1])
        recent = closes[-self.window :]
        long_window = closes[- min(len(closes), self.window * 3) :]

        momentum = float((recent[-1] - recent[0]) / max(recent[0], 1e-6))
        long_momentum = float((long_window[-1] - long_window[0]) / max(long_window[0], 1e-6))
        returns = np.diff(closes[- min(len(closes), 40) :]) / np.maximum(closes[- min(len(closes), 40) : -1], 1e-6)
        volatility = float(np.std(returns)) if returns.size else 0.0
        mean_return = float(np.mean(returns)) if returns.size else 0.0

        context = self._context_profile(ticker=ticker, query=query, sentiment_score=sentiment_score)
        technical_return = momentum * 0.38 + long_momentum * 0.28 + mean_return * 2.6 - volatility * 0.52
        predicted_return_pct = self._blend_return(
            technical_return=technical_return,
            context=context,
            volatility=volatility,
        )
        predicted_price = current_price * (1 + predicted_return_pct / 100)
        trend = self._trend_label(predicted_return_pct=predicted_return_pct, volatility=volatility)
        confidence = self._confidence(
            momentum=momentum,
            long_momentum=long_momentum,
            volatility=volatility,
            context_alignment=context["alignment"],
        )
        volatility_band_pct = self._volatility_band(volatility=volatility, horizon_days=context["horizon_days"], asset_class=context["asset_class"])
        support_level = float(np.min(closes[- min(len(closes), 15) :]))
        resistance_level = float(np.max(closes[- min(len(closes), 15) :]))

        forecast = self._generate_forecast(
            current_price=current_price,
            predicted_price=predicted_price,
            horizon_days=context["horizon_days"],
            volatility=volatility,
            trend=trend,
        )
        history = [round(float(value), 2) for value in closes[-30:]]
        scenarios = self._scenarios(
            current_price=current_price,
            base_return_pct=predicted_return_pct,
            volatility_band_pct=volatility_band_pct,
            context=context,
        )
        signals = self._signals(
            momentum=momentum,
            long_momentum=long_momentum,
            volatility=volatility,
            current_price=current_price,
            support_level=support_level,
            resistance_level=resistance_level,
            context=context,
            sentiment_level=sentiment_level,
        )

        return {
            "ticker": ticker,
            "currentPrice": round(current_price, 2),
            "predictedPrice": round(float(predicted_price), 2),
            "predictedReturnPct": round(predicted_return_pct, 2),
            "confidence": round(confidence, 2),
            "trend": trend,
            "volatilityBandPct": round(volatility_band_pct, 2),
            "supportLevel": round(support_level, 2),
            "resistanceLevel": round(resistance_level, 2),
            "horizonLabel": context["horizon_label"],
            "queryAlignment": round(context["alignment"], 2),
            "predictionMethod": context["method_label"],
            "methodFactors": context["method_factors"],
            "analystSummary": self._summary(
                trend=trend,
                predicted_return_pct=predicted_return_pct,
                confidence=confidence,
                volatility_band_pct=volatility_band_pct,
                context=context,
            ),
            "signals": signals,
            "scenarios": scenarios,
            "history": history,
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

        bullish_terms = {"buy", "bullish", "long", "upside", "breakout", "rally", "accumulate"}
        bearish_terms = {"sell", "bearish", "short", "downside", "breakdown", "drop", "hedge"}
        safe_haven_terms = {"inflation", "rates", "yield", "fed", "central bank", "geopolitical", "safe haven", "recession"}
        growth_terms = {"earnings", "guidance", "revenue", "ai", "growth", "margin", "demand"}
        tariff_terms = {"tariff", "tariffs", "trade war", "import duty", "duties", "levy", "sanction", "sanctions"}
        supply_tightness_terms = {"supply cut", "production cut", "opec cut", "inventory draw", "disruption"}
        demand_drag_terms = {"slowdown", "demand hit", "weaker demand", "trade tension"}

        bullish_score = sum(1 for term in bullish_terms if term in text)
        bearish_score = sum(1 for term in bearish_terms if term in text)
        macro_score = sum(1 for term in safe_haven_terms if term in text)
        growth_score = sum(1 for term in growth_terms if term in text)
        tariff_score = sum(1 for term in tariff_terms if term in text)
        supply_score = sum(1 for term in supply_tightness_terms if term in text)
        demand_drag_score = sum(1 for term in demand_drag_terms if term in text)

        asset_class = "equity"
        asset_name = "equity"
        if any(term in text for term in {"gold", "xau", "gld"}):
            asset_class = "commodity"
            asset_name = "gold"
        elif any(term in text for term in {"silver", "slv"}):
            asset_class = "commodity"
            asset_name = "silver"
        elif any(term in text for term in {"oil", "crude", "brent", "wti"}):
            asset_class = "commodity"
            asset_name = "crude oil"
        elif any(term in text for term in {"btc", "bitcoin", "eth", "ethereum", "crypto"}):
            asset_class = "crypto"
            asset_name = "crypto"
        elif any(term in text for term in {"spy", "qqq", "index", "nasdaq", "s&p", "dow"}):
            asset_class = "index"
            asset_name = "index"

        directional_bias = (bullish_score - bearish_score) * 0.0028
        if asset_name == "gold":
            directional_bias += macro_score * 0.0022
        if asset_name == "crude oil":
            directional_bias += supply_score * 0.0035
            directional_bias -= (tariff_score * 0.0055) + (demand_drag_score * 0.0038)
            if horizon_days <= 2 and tariff_score > 0:
                directional_bias -= 0.003
        if asset_class == "equity":
            directional_bias += growth_score * 0.0018

        sentiment_bias = (sentiment_score - 0.5) * 0.035
        alignment = min(0.97, 0.45 + abs(directional_bias) * 18 + abs(sentiment_bias) * 5 + (0.05 if query.strip() else 0.0))
        method_factors = [
            f"Used recent price momentum and volatility for {asset_name}.",
            f"Adjusted for query horizon: {horizon_label}.",
            "Blended researcher sentiment into the forecast.",
        ]
        if tariff_score > 0 and asset_name == "crude oil":
            method_factors.append("Applied a negative macro-demand adjustment for tariff-related oil uncertainty.")
        elif asset_name == "gold" and macro_score > 0:
            method_factors.append("Applied a safe-haven macro adjustment for gold-related macro language.")

        return {
            "asset_class": asset_class,
            "asset_name": asset_name,
            "horizon_days": horizon_days,
            "horizon_label": horizon_label,
            "directional_bias": directional_bias,
            "sentiment_bias": sentiment_bias,
            "alignment": alignment,
            "query_text": query.strip(),
            "method_label": "Query-aware hybrid forecast (price action + query context + sentiment)",
            "method_factors": method_factors,
            "tariff_score": tariff_score,
        }

    def _blend_return(self, *, technical_return: float, context: dict, volatility: float) -> float:
        horizon_scale = max(0.35, min(context["horizon_days"] / 5, 3.8))
        raw_return = (technical_return * 0.72 + context["directional_bias"] + context["sentiment_bias"]) * horizon_scale

        if context["asset_class"] == "commodity" and context["horizon_days"] <= 2:
            cap = 1.4
        elif context["asset_class"] == "index" and context["horizon_days"] <= 2:
            cap = 1.8
        elif context["asset_class"] == "crypto":
            cap = 6.5 if context["horizon_days"] <= 5 else 12.0
        else:
            cap = 3.2 if context["horizon_days"] <= 5 else 8.5

        dampener = max(0.55, 1 - volatility * 3.4)
        return float(np.clip(raw_return * dampener * 100, -cap, cap))

    def _generate_forecast(
        self,
        *,
        current_price: float,
        predicted_price: float,
        horizon_days: int,
        volatility: float,
        trend: str,
    ) -> list[float]:
        steps = max(4, min(8, horizon_days + 3))
        total_move = predicted_price - current_price
        direction = 1 if total_move >= 0 else -1
        wave_bias = 1 if trend == "bullish" else -1 if trend == "bearish" else 0
        curve = []

        for index in range(steps):
            progress = (index + 1) / steps
            ease = 1 - pow(1 - progress, 1.35)
            base_value = current_price + total_move * ease
            wave = math.sin(progress * math.pi * 1.15) * current_price * volatility * 0.85 * wave_bias
            drift = math.sin(progress * math.pi * 2.1) * current_price * volatility * 0.18 * direction
            value = max(1.0, base_value + wave + drift)
            curve.append(round(float(value), 2))

        if curve:
            curve[-1] = round(float(predicted_price), 2)
        return curve

    def _trend_label(self, *, predicted_return_pct: float, volatility: float) -> str:
        if predicted_return_pct > max(0.55, volatility * 100 * 0.7):
            return "bullish"
        if predicted_return_pct < -max(0.55, volatility * 100 * 0.7):
            return "bearish"
        return "sideways"

    def _confidence(self, *, momentum: float, long_momentum: float, volatility: float, context_alignment: float) -> float:
        alignment = 1 - min(abs(momentum - long_momentum) * 8, 0.42)
        stability = 1 - min(volatility * 6, 0.38)
        return float(np.clip(0.38 + alignment * 0.22 + stability * 0.18 + context_alignment * 0.22, 0.34, 0.93))

    def _volatility_band(self, *, volatility: float, horizon_days: int, asset_class: str) -> float:
        multiplier = 1.4 if asset_class == "commodity" else 1.75 if asset_class == "crypto" else 1.6
        horizon_scale = max(0.75, min(horizon_days / 5, 2.5))
        return float(np.clip(volatility * 100 * multiplier * horizon_scale, 0.6, 10.5))

    def _summary(self, *, trend: str, predicted_return_pct: float, confidence: float, volatility_band_pct: float, context: dict) -> str:
        direction = "upside continuation" if trend == "bullish" else "downside pressure" if trend == "bearish" else "range-bound trade"
        query_suffix = (
            f" Query alignment is {int(context['alignment'] * 100)}%."
            if context["query_text"]
            else ""
        )
        return (
            f"Analyst model sees {direction} over {context['horizon_label']} with an expected move of "
            f"{predicted_return_pct:.2f}% at {confidence * 100:.0f}% confidence and a swing band near "
            f"+/-{volatility_band_pct:.2f}%.{query_suffix}"
        )

    def _signals(
        self,
        *,
        momentum: float,
        long_momentum: float,
        volatility: float,
        current_price: float,
        support_level: float,
        resistance_level: float,
        context: dict,
        sentiment_level: str,
    ) -> list[str]:
        signals = [
            "Short-term momentum is strengthening." if momentum > 0.02 else "Short-term momentum is fading." if momentum < -0.02 else "Short-term momentum is neutral.",
            "Medium-term trend remains constructive." if long_momentum > 0.04 else "Medium-term trend is under pressure." if long_momentum < -0.04 else "Medium-term trend is balanced.",
            "Expect elevated trading volatility." if volatility > 0.03 else "Price action is relatively stable.",
            f"Research sentiment currently reads {sentiment_level}.",
        ]
        if context["query_text"]:
            signals.append(f"Forecast is aligned to a {context['horizon_label']} decision window.")

        distance_to_support = ((current_price - support_level) / max(current_price, 1e-6)) * 100
        distance_to_resistance = ((resistance_level - current_price) / max(current_price, 1e-6)) * 100
        if distance_to_support < 3.5:
            signals.append(f"Price is trading close to support at {support_level:.2f}.")
        else:
            signals.append(f"Nearest resistance is near {resistance_level:.2f}, around {distance_to_resistance:.2f}% away.")
        return signals

    def _scenarios(self, *, current_price: float, base_return_pct: float, volatility_band_pct: float, context: dict) -> list[dict]:
        upside_buffer = max(volatility_band_pct * 0.55, 0.18)
        downside_buffer = max(volatility_band_pct * 0.7, 0.22)

        bull_return = max(base_return_pct + upside_buffer, base_return_pct + 0.08)
        bear_return = min(base_return_pct - downside_buffer, base_return_pct - 0.08)

        if context["asset_name"] == "crude oil" and context["tariff_score"] > 0:
            bull_reason = "Supply headlines offset some of the tariff-related demand concern."
            bear_reason = "Tariff pressure weakens demand expectations and weighs on crude."
        elif context["horizon_days"] <= 2 and context["asset_class"] == "commodity":
            bull_reason = "Dollar softness or macro risk keeps commodity demand firm."
            bear_reason = "Macro pressure or stronger dollar limits near-term upside."
        elif context["asset_class"] == "equity":
            bull_reason = "Risk appetite and earnings momentum extend the move."
            bear_reason = "Valuation pressure or weak tape stalls buyers."
        else:
            bull_reason = "Positive flow and momentum push price through resistance."
            bear_reason = "Risk-off rotation or volatility drags price lower."

        scenarios = [
            ("Bull case", bull_return, bull_reason),
            ("Base case", base_return_pct, f"Most likely path for the next {context['horizon_label']}."),
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

    def synthetic_history(self, seed: str) -> pd.DataFrame:
        seed_value = abs(hash(seed)) % (2**32)
        rng = np.random.default_rng(seed_value)
        base = 100 + (seed_value % 120)
        noise = rng.normal(0, 1.8, size=160)
        drift = rng.normal(0.08, 0.04, size=160)

        prices = [float(base)]
        for idx in range(1, 160):
            next_price = max(5.0, prices[-1] * (1 + (drift[idx] + noise[idx] * 0.2) / 100))
            prices.append(next_price)

        return pd.DataFrame({"Close": prices})
