"""Risk Reasoning Agent (FINDEC v1).

This agent did not exist in the crashing commit -- orchestrator/crew.py
imported `from ..agents.risk_reasoning import RiskReasoningAgent` and the
file was simply missing, which crashed the FastAPI process at import time.

Purpose: the Risk Manager (risk_manager.py) computes *quantitative* risk
(VaR, recommended position size). This agent answers a different
question -- "what could invalidate this prediction?" -- by reasoning over
the prediction, the quantitative risk numbers, market technicals, and
sentiment together, the way a human risk desk would sanity-check a model
output before sizing a position. This is the "Risk Reasoning" stage from
the agreed FINDEC v1 pipeline (Prediction Engine -> Risk Reasoning Agent
-> Verification Agent).

Fail-soft: if ANTHROPIC_API_KEY isn't set (or the call fails), a
deterministic rule-based reasoner produces the same schema so the
pipeline never breaks and never fabricates data to compensate.
"""

import time
from typing import Dict, List, Optional

try:
    from ..services.llm_client import get_llm_client
except Exception:
    try:
        from services.llm_client import get_llm_client
    except ModuleNotFoundError:
        from python_agents.services.llm_client import get_llm_client

RISK_REASONING_SYSTEM_PROMPT = """You are the Risk Reasoning Agent in a financial \
decision system. You are given a model's price prediction, its quantitative risk \
metrics (Value-at-Risk, recommended position size), current technical indicators, and \
news sentiment. Your job is NOT to recompute VaR -- it is to reason about what could \
invalidate the prediction and how much the position size should be adjusted for that. \
Respond with ONLY a JSON object, no prose, no markdown fences, matching exactly this \
schema:
{
  "invalidatingFactors": ["<specific event/condition that would break this prediction>", ...],
  "confidenceAdjustment": <float between -0.3 and 0.0, how much to reduce the \
prediction's confidence given these factors; 0.0 if nothing material>,
  "positionSizeAdjustment": <float between -0.5 and 0.0, fractional cut to the \
recommended position size; 0.0 if no cut warranted>,
  "narrative": "<1-3 sentence explanation a retail investor would understand>"
}
Ground every factor in the actual numbers given -- do not invent events. If volatility, \
VaR, RSI, or sentiment confidence already look benign, it is fine to return empty \
invalidatingFactors and zero adjustments."""

HIGH_VOLATILITY_PCT = 3.5
EXTREME_VOLATILITY_PCT = 6.0
RSI_OVERBOUGHT = 70
RSI_OVERSOLD = 30
LOW_CONFIDENCE = 0.5


class RiskReasoningAgent:
    """Reasons over prediction + quantitative risk + market + sentiment to
    flag what could invalidate the prediction, and by how much position
    sizing / confidence should be discounted for that."""

    def __init__(self) -> None:
        self.llm = get_llm_client()

    def reason(
        self,
        ticker: str,
        prediction: Optional[dict],
        risk: Optional[dict],
        market: Optional[dict],
        sentiment: Optional[dict],
    ) -> dict:
        start = time.perf_counter()

        deterministic = self._reason_deterministic(
            ticker=ticker, prediction=prediction, risk=risk, market=market, sentiment=sentiment
        )

        llm_result = self._reason_with_llm(
            ticker=ticker, prediction=prediction, risk=risk, market=market, sentiment=sentiment
        )
        if llm_result is None:
            deterministic["reasonedBy"] = "deterministic"
            deterministic["durationMs"] = int((time.perf_counter() - start) * 1000)
            return deterministic

        result = {
            "invalidatingFactors": llm_result.get("invalidatingFactors", deterministic["invalidatingFactors"]),
            "confidenceAdjustment": llm_result.get("confidenceAdjustment", deterministic["confidenceAdjustment"]),
            "positionSizeAdjustment": llm_result.get("positionSizeAdjustment", deterministic["positionSizeAdjustment"]),
            "narrative": llm_result.get("narrative", deterministic["narrative"]),
            "reasonedBy": "llm",
            "message": f"Risk reasoning completed for {ticker}.",
            "durationMs": int((time.perf_counter() - start) * 1000),
        }
        return result

    def _reason_with_llm(
        self,
        ticker: str,
        prediction: Optional[dict],
        risk: Optional[dict],
        market: Optional[dict],
        sentiment: Optional[dict],
    ) -> Optional[dict]:
        if not self.llm.available:
            return None
        context = {
            "ticker": ticker,
            "predictedReturnPct": prediction.get("predictedReturnPct") if prediction else None,
            "predictionConfidence": prediction.get("confidence") if prediction else None,
            "valueAtRiskPct": risk.get("valueAtRiskPct") if risk else None,
            "riskLevel": risk.get("level") if risk else None,
            "recommendedPositionSizePct": risk.get("recommendedPositionSizePct") if risk else None,
            "volatilityPct": market.get("volatilityPct") if market else None,
            "rsi": market.get("rsi") if market else None,
            "trend": market.get("trend") if market else None,
            "sentimentLevel": sentiment.get("level") if sentiment else None,
            "sentimentConfidence": sentiment.get("confidence") if sentiment else None,
        }
        result = self.llm.complete_json(
            system=RISK_REASONING_SYSTEM_PROMPT, user=f"Signals: {context}", max_tokens=400
        )
        if not result:
            return None
        if not isinstance(result.get("invalidatingFactors"), list):
            return None
        try:
            result["confidenceAdjustment"] = max(-0.3, min(0.0, float(result.get("confidenceAdjustment", 0.0))))
            result["positionSizeAdjustment"] = max(-0.5, min(0.0, float(result.get("positionSizeAdjustment", 0.0))))
        except (TypeError, ValueError):
            return None
        if not isinstance(result.get("narrative"), str):
            return None
        return result

    def _reason_deterministic(
        self,
        ticker: str,
        prediction: Optional[dict],
        risk: Optional[dict],
        market: Optional[dict],
        sentiment: Optional[dict],
    ) -> dict:
        factors: List[str] = []
        confidence_adjustment = 0.0
        position_adjustment = 0.0

        volatility_pct = (market or {}).get("volatilityPct")
        if volatility_pct is not None:
            if volatility_pct >= EXTREME_VOLATILITY_PCT:
                factors.append(f"20-day volatility is {volatility_pct}% -- extreme, prediction reliability drops sharply.")
                confidence_adjustment -= 0.15
                position_adjustment -= 0.25
            elif volatility_pct >= HIGH_VOLATILITY_PCT:
                factors.append(f"20-day volatility is {volatility_pct}% -- elevated for a {ticker} position.")
                confidence_adjustment -= 0.08
                position_adjustment -= 0.1

        rsi = (market or {}).get("rsi")
        if rsi is not None:
            if rsi >= RSI_OVERBOUGHT:
                factors.append(f"RSI={rsi} indicates {ticker} is technically overbought; a pullback could invalidate an upward prediction.")
                position_adjustment -= 0.1
            elif rsi <= RSI_OVERSOLD:
                factors.append(f"RSI={rsi} indicates {ticker} is technically oversold; a bounce could invalidate a downward prediction.")
                position_adjustment -= 0.1

        prediction_confidence = (prediction or {}).get("confidence")
        if prediction_confidence is not None and prediction_confidence < LOW_CONFIDENCE:
            factors.append(f"Model prediction confidence is only {prediction_confidence}; treat the forecast as directional, not precise.")
            confidence_adjustment -= 0.1

        sentiment_confidence = (sentiment or {}).get("confidence")
        if sentiment_confidence is not None and sentiment_confidence < LOW_CONFIDENCE:
            factors.append(f"News sentiment confidence is only {sentiment_confidence}; the sentiment signal is weak evidence on its own.")

        if risk and risk.get("level") == "high":
            factors.append(f"Risk Manager already flags {ticker} as high risk (VaR={risk.get('valueAtRiskPct')}%).")
            position_adjustment -= 0.1

        confidence_adjustment = max(-0.3, confidence_adjustment)
        position_adjustment = max(-0.5, position_adjustment)

        if factors:
            narrative = (
                f"{len(factors)} factor(s) could invalidate this prediction for {ticker}; "
                f"position size and confidence have been discounted accordingly."
            )
        else:
            narrative = f"No material invalidating factors found for {ticker}'s current prediction."

        return {
            "invalidatingFactors": factors,
            "confidenceAdjustment": round(confidence_adjustment, 3),
            "positionSizeAdjustment": round(position_adjustment, 3),
            "narrative": narrative,
            "message": f"Risk reasoning completed for {ticker}.",
        }
