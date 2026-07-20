"""Explanation Agent (FINDEC v1).

Turns the recommendation plus every upstream agent's output into a
transparent, human-readable explanation: main reasons, main risks, and
what evidence is missing. This is the last stage in the pipeline -- it
does not change the recommendation, it explains it.

v1 is template-based (no LLM call, no API key). Every field it outputs is
computed directly from numbers already produced upstream by the Researcher,
Market Agent, Analyst, Risk Manager, and Verification Agent.
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

EXPLANATION_SYSTEM_PROMPT = """You are the Explanation Agent in a financial decision \
system. Given a recommendation and the reasons, risks, and missing evidence behind it, \
write a 2-4 sentence plain-language explanation a retail investor would understand. \
Be factual and only reference the specific reasons/risks given -- do not invent numbers \
or claims not present in the input. Respond with plain text only, no JSON, no markdown."""


class ExplanationAgent:
    """Formats the final recommendation into reasons, risks, and gaps."""

    def __init__(self) -> None:
        self.llm = get_llm_client()

    def explain(
        self,
        ticker: str,
        recommendation: dict,
        sentiment: dict,
        market: dict,
        prediction: Optional[dict],
        risk: Optional[dict],
        verification: dict,
    ) -> dict:
        start = time.perf_counter()

        reasons = self._main_reasons(sentiment=sentiment, market=market, prediction=prediction)
        risks = self._main_risks(risk=risk, verification=verification, market=market)
        missing_evidence = self._missing_evidence(prediction=prediction, risk=risk, verification=verification)

        action = recommendation.get("action", "hold")
        buy_score = recommendation.get("buyScore")
        confidence_note = (
            "high confidence" if verification.get("status") == "consistent"
            else "mixed confidence" if verification.get("status") == "low_confidence"
            else "conflicting signals -- treat with caution"
        )

        template_summary = (
            f"{action.upper()} {ticker} (buy score {buy_score}) based on "
            f"{len(reasons)} supporting factor(s), with {confidence_note}."
        )

        llm_summary = self._summarize_with_llm(
            ticker=ticker, action=action, buy_score=buy_score,
            reasons=reasons, risks=risks, missing_evidence=missing_evidence,
            confidence_note=confidence_note,
        )
        used_llm = llm_summary is not None
        summary = llm_summary if used_llm else template_summary

        return {
            "summary": summary,
            "mainReasons": reasons,
            "mainRisks": risks,
            "missingEvidence": missing_evidence,
            "confidenceNote": confidence_note,
            "explainedBy": "llm" if used_llm else "deterministic",
            "message": f"Explained {action} recommendation for {ticker}.",
            "durationMs": int((time.perf_counter() - start) * 1000),
        }

    def _summarize_with_llm(
        self,
        ticker: str,
        action: str,
        buy_score,
        reasons: List[str],
        risks: List[str],
        missing_evidence: List[str],
        confidence_note: str,
    ) -> Optional[str]:
        if not self.llm.available:
            return None
        user_prompt = (
            f"Ticker: {ticker}\nAction: {action}\nBuy score: {buy_score}\n"
            f"Confidence: {confidence_note}\nReasons: {reasons}\nRisks: {risks}\n"
            f"Missing evidence: {missing_evidence}"
        )
        text = self.llm.complete(system=EXPLANATION_SYSTEM_PROMPT, user=user_prompt, max_tokens=300)
        if not text:
            return None
        return text

    def _main_reasons(self, sentiment: dict, market: dict, prediction: Optional[dict]) -> List[str]:
        reasons: List[str] = []

        sentiment_level = sentiment.get("level", "HOLD")
        sentiment_score = sentiment.get("score")
        reasons.append(f"Researcher sentiment is {sentiment_level} (score={sentiment_score}).")

        trend = market.get("trend")
        if trend:
            reasons.append(
                f"Market Agent shows a {trend} ({market.get('movingAverageShort')} vs "
                f"{market.get('movingAverageLong')} moving averages)."
            )

        if prediction is not None:
            predicted_return = prediction.get("predictedReturnPct")
            confidence = prediction.get("confidence")
            reasons.append(
                f"Analyst predicts a {predicted_return}% move with confidence {confidence}."
            )

        return reasons

    def _main_risks(self, risk: Optional[dict], verification: dict, market: dict) -> List[str]:
        risks: List[str] = []

        if risk is not None:
            risks.append(
                f"Risk Manager reports {risk.get('level')} risk "
                f"(VaR={risk.get('valueAtRiskPct')}%, recommended position={risk.get('recommendedPositionSizePct')}%)."
            )

        volatility_pct = market.get("volatilityPct")
        if volatility_pct is not None:
            risks.append(f"20-day price volatility is {volatility_pct}%.")

        for conflict in verification.get("conflicts", []):
            risks.append(conflict)

        return risks

    def _missing_evidence(self, prediction: Optional[dict], risk: Optional[dict], verification: dict) -> List[str]:
        missing: List[str] = []
        if prediction is None:
            missing.append("No Analyst prediction was generated for this request (version < 2).")
        if risk is None:
            missing.append("No Risk Manager evaluation was generated for this request (version < 4).")
        missing.extend(verification.get("warnings", []))
        return missing