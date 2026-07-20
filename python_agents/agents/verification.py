"""Verification Agent (FINDEC v1).

Checks whether the Researcher (sentiment), Analyst (prediction), and Risk
Manager outputs actually agree before a recommendation is trusted, instead
of blindly passing everything through to the Final Decision stage. Flags
conflicts (e.g. bullish sentiment vs. bearish prediction) and low-evidence
situations, and reports what's missing.

v1 scope: informational only. It does not change buy_score or the final
action -- it annotates the response so the orchestrator/UI/paper can show
*why* a recommendation should or shouldn't be trusted. Wiring verification
outcomes into the decision itself is a v2 step (see Phase 4 in the design
doc), kept separate here so it doesn't disturb the existing v1-v4
recommendation logic in crew.py.
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

VERIFICATION_SYSTEM_PROMPT = """You are the Verification Agent in a financial decision \
system. You are given the outputs of a Researcher (news sentiment), Market Agent \
(technical indicators), Analyst (prediction), and Risk Manager (VaR). Identify any \
genuine conflicts between these signals (not just differences in framing) and any \
places where the evidence is too thin to trust. Respond with ONLY a JSON object, no \
prose, no markdown fences:
{
  "status": "consistent" | "low_confidence" | "conflict",
  "conflicts": ["<conflict description>", ...],
  "warnings": ["<evidence gap description>", ...]
}
Empty arrays are fine if there's nothing to flag. Be specific and reference the actual
numbers given, not generic statements."""

SENTIMENT_BULLISH_LEVELS = {"BUY", "STRONG_BUY"}
SENTIMENT_BEARISH_LEVELS = {"SELL", "STRONG_SELL"}

LOW_CONFIDENCE_THRESHOLD = 0.5
LOW_RESOURCE_COUNT = 2
HIGH_RISK_LEVEL = "high"


class VerificationAgent:
    """Cross-checks agent outputs for conflicts and insufficient evidence."""

    def __init__(self) -> None:
        self.llm = get_llm_client()

    def verify(
        self,
        sentiment: dict,
        prediction: Optional[dict],
        risk: Optional[dict],
        market: Optional[dict] = None,
    ) -> dict:
        start = time.perf_counter()

        deterministic = self._verify_deterministic(
            sentiment=sentiment, prediction=prediction, risk=risk, market=market
        )

        llm_result = self._verify_with_llm(
            sentiment=sentiment, prediction=prediction, risk=risk, market=market
        )
        if llm_result is None:
            deterministic["verifiedBy"] = "deterministic"
            deterministic["durationMs"] = int((time.perf_counter() - start) * 1000)
            return deterministic

        status = llm_result.get("status", deterministic["status"])
        conflicts = llm_result.get("conflicts", deterministic["conflicts"])
        warnings = llm_result.get("warnings", deterministic["warnings"])
        return {
            "status": status,
            "conflicts": conflicts,
            "warnings": warnings,
            "verifiedBy": "llm",
            "message": (
                "Verification found conflicting signals." if conflicts
                else "Verification found low-confidence evidence." if warnings
                else "Researcher, Analyst, Risk Manager, and Market signals are consistent."
            ),
            "durationMs": int((time.perf_counter() - start) * 1000),
        }

    def _verify_with_llm(
        self,
        sentiment: dict,
        prediction: Optional[dict],
        risk: Optional[dict],
        market: Optional[dict],
    ) -> Optional[dict]:
        if not self.llm.available:
            return None
        context = {
            "sentimentLevel": sentiment.get("level"),
            "sentimentConfidence": sentiment.get("confidence"),
            "resourceCount": len(sentiment.get("resources", []) or []),
            "predictedReturnPct": prediction.get("predictedReturnPct") if prediction else None,
            "predictionConfidence": prediction.get("confidence") if prediction else None,
            "marketTrend": market.get("trend") if market else None,
            "riskLevel": risk.get("level") if risk else None,
            "valueAtRiskPct": risk.get("valueAtRiskPct") if risk else None,
        }
        result = self.llm.complete_json(
            system=VERIFICATION_SYSTEM_PROMPT, user=f"Signals: {context}", max_tokens=400
        )
        if not result:
            return None
        if result.get("status") not in {"consistent", "low_confidence", "conflict"}:
            return None
        if not isinstance(result.get("conflicts"), list) or not isinstance(result.get("warnings"), list):
            return None
        return result

    def _verify_deterministic(
        self,
        sentiment: dict,
        prediction: Optional[dict],
        risk: Optional[dict],
        market: Optional[dict] = None,
    ) -> dict:
        start = time.perf_counter()
        conflicts: List[str] = []
        warnings: List[str] = []

        sentiment_level = sentiment.get("level", "HOLD")
        sentiment_confidence = float(sentiment.get("confidence", 0.5))
        resource_count = len(sentiment.get("resources", []) or [])

        if resource_count <= LOW_RESOURCE_COUNT:
            warnings.append(
                f"Only {resource_count} research resource(s) backed the sentiment call; evidence is thin."
            )
        if sentiment_confidence < LOW_CONFIDENCE_THRESHOLD:
            warnings.append(
                f"Researcher confidence ({sentiment_confidence}) is below {LOW_CONFIDENCE_THRESHOLD}."
            )

        if prediction is not None:
            predicted_return = float(prediction.get("predictedReturnPct", 0.0))
            prediction_direction = "up" if predicted_return > 0 else "down" if predicted_return < 0 else "flat"

            if sentiment_level in SENTIMENT_BULLISH_LEVELS and prediction_direction == "down":
                conflicts.append(
                    f"Researcher sentiment is {sentiment_level} but Analyst predicts a {round(predicted_return, 2)}% move down."
                )
            elif sentiment_level in SENTIMENT_BEARISH_LEVELS and prediction_direction == "up":
                conflicts.append(
                    f"Researcher sentiment is {sentiment_level} but Analyst predicts a {round(predicted_return, 2)}% move up."
                )

            prediction_confidence = float(prediction.get("confidence", 0.5))
            if prediction_confidence < LOW_CONFIDENCE_THRESHOLD:
                warnings.append(
                    f"Analyst confidence ({prediction_confidence}) is below {LOW_CONFIDENCE_THRESHOLD}."
                )
        else:
            warnings.append("No Analyst prediction available to cross-check against sentiment.")

        if market is not None and prediction is not None:
            predicted_return = float(prediction.get("predictedReturnPct", 0.0))
            trend = market.get("trend")
            if trend == "downtrend" and predicted_return > 0:
                conflicts.append(
                    f"Market Agent reports a downtrend but Analyst predicts a {round(predicted_return, 2)}% move up."
                )
            elif trend == "uptrend" and predicted_return < 0:
                conflicts.append(
                    f"Market Agent reports an uptrend but Analyst predicts a {round(predicted_return, 2)}% move down."
                )

        if risk is not None and risk.get("level") == HIGH_RISK_LEVEL:
            warnings.append("Risk Manager flagged high risk; recommendation should weigh this heavily.")
        elif risk is None:
            warnings.append("No Risk Manager evaluation available.")

        if conflicts:
            status = "conflict"
        elif warnings:
            status = "low_confidence"
        else:
            status = "consistent"

        return {
            "status": status,
            "conflicts": conflicts,
            "warnings": warnings,
            "message": (
                "Verification found conflicting signals." if conflicts
                else "Verification found low-confidence evidence." if warnings
                else "Researcher, Analyst, Risk Manager, and Market signals are consistent."
            ),
            "durationMs": int((time.perf_counter() - start) * 1000),
        }