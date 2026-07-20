"""Orchestrator (FINDEC v1 -- full agentic pipeline).

    Planner
      |
      v
    Structured task (JSON)
      |
      +----------------+----------------+
      v                                 v
  Research Agent                  Market Agent      <- run in parallel
      |                                 |
      +----------------+----------------+
                        v
                Prediction Engine (Analyst)
                        v
                  Risk Manager  ->  Risk Reasoning Agent
                        v
                 Verification Agent
                        v
              Recommendation Generator (weighted)
                        v
                 Explanation Agent

This replaces the old version=1..4 branching (which silently ran a
different, less-complete pipeline depending on a request field) with one
pipeline that always runs every agent. `version` is still accepted/echoed
in the request/response purely so the existing Node/Next client (which
still has a version selector in its UI) doesn't break; it no longer
changes what gets computed.

No agent in this pipeline fabricates data when a live source is
unavailable. Instead, each upstream agent reports `dataAvailable: False`
and this orchestrator degrades the recommendation accordingly (see
`_build_recommendation`) rather than quietly blending in a null/zero
value as if it were a real signal.
"""

import time
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Optional

try:
    from ..agents.analyst import AnalystAgent
    from ..agents.researcher import ResearcherAgent
    from ..agents.risk_manager import RiskManagerAgent
    from ..agents.planner import PlannerAgent
    from ..agents.market_agent import MarketAgent
    from ..agents.verification import VerificationAgent
    from ..agents.explanation import ExplanationAgent
    from ..agents.risk_reasoning import RiskReasoningAgent
except Exception:
    try:
        from agents.analyst import AnalystAgent
        from agents.researcher import ResearcherAgent
        from agents.risk_manager import RiskManagerAgent
        from agents.planner import PlannerAgent
        from agents.market_agent import MarketAgent
        from agents.verification import VerificationAgent
        from agents.explanation import ExplanationAgent
        from agents.risk_reasoning import RiskReasoningAgent
    except ModuleNotFoundError:
        from python_agents.agents.analyst import AnalystAgent
        from python_agents.agents.researcher import ResearcherAgent
        from python_agents.agents.risk_manager import RiskManagerAgent
        from python_agents.agents.planner import PlannerAgent
        from python_agents.agents.market_agent import MarketAgent
        from python_agents.agents.verification import VerificationAgent
        from python_agents.agents.explanation import ExplanationAgent
        from python_agents.agents.risk_reasoning import RiskReasoningAgent


# Weighting constants for the Recommendation Generator. Kept as named
# module-level constants (rather than magic numbers inline) so the paper /
# docs can cite exactly how the buy score is built.
SENTIMENT_WEIGHT_POINTS = 40.0        # max +/- points sentiment can move the score
PREDICTION_WEIGHT_POINTS = 30.0       # max +/- points the prediction can move the score
RISK_HIGH_PENALTY = 20.0
RISK_MEDIUM_PENALTY = 8.0
RISK_LOW_PENALTY = 0.0

BUY_THRESHOLD = 63.0
SELL_THRESHOLD = 37.0

MIN_PREDICTION_CONFIDENCE_FOR_BUY = 0.55
MIN_BACKTEST_ACCURACY_FOR_BUY = 52.0

SIZE_PCT_BY_RISK_PROFILE = {"low": 0.06, "medium": 0.1, "high": 0.16}


class FinanceCrew:
    DISCLAIMER = "FINDEC is a decision support tool only and does not constitute financial advice."

    def __init__(self) -> None:
        self.planner = PlannerAgent()
        self.researcher = ResearcherAgent()
        self.market_agent = MarketAgent()
        self.analyst = AnalystAgent()
        self.risk_manager = RiskManagerAgent()
        self.risk_reasoner = RiskReasoningAgent()
        self.verifier = VerificationAgent()
        self.explainer = ExplanationAgent()
        # Two workers: Research Agent and Market Agent run independently
        # and neither depends on the other's output, so they run
        # concurrently (both are I/O-bound network calls).
        self._pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="findec-parallel")

    def run(self, query: dict) -> dict:
        ticker = query["ticker"].upper()
        user_query = query["query"]
        budget = float(query["budget"])
        risk_profile = str(query.get("risk_profile", "medium")).lower()
        # `version` is accepted only for API backward compatibility with
        # the existing client; it no longer changes pipeline behavior.
        requested_version = int(query.get("version", 4))

        risk_profile = {
            "conservative": "low",
            "moderate": "medium",
            "aggressive": "high",
        }.get(risk_profile, risk_profile)

        agent_logs: List[Dict] = []

        # --- Planner ---------------------------------------------------
        plan = self.planner.plan(
            query=user_query,
            ticker=ticker,
            budget=budget,
            risk_profile=risk_profile,
        )
        agent_logs.append(self._log("Planner", plan, "Planning completed"))

        # --- Research Agent + Market Agent, in parallel ----------------
        research_future = self._pool.submit(self.researcher.analyze, ticker=ticker, query=user_query)
        market_future = self._pool.submit(self.market_agent.fetch, ticker=ticker)
        sentiment = research_future.result()
        market = market_future.result()
        agent_logs.append(self._log("Researcher", sentiment, "Sentiment completed"))
        agent_logs.append(self._log("Market Agent", market, "Market data fetched"))

        # --- Prediction Engine (Analyst) --------------------------------
        prediction = self.analyst.predict(ticker=ticker, query=user_query, sentiment=sentiment)
        agent_logs.append(self._log("Analyst", prediction, "Prediction completed"))

        # --- Risk Manager (quantitative) + Risk Reasoning (qualitative) -
        risk = self.risk_manager.evaluate(
            ticker=ticker, budget=budget, risk_profile=risk_profile, prediction=prediction
        )
        agent_logs.append(self._log("Risk Manager", risk, "Risk evaluation completed"))

        risk_reasoning = self.risk_reasoner.reason(
            ticker=ticker, prediction=prediction, risk=risk, market=market, sentiment=sentiment
        )
        agent_logs.append(self._log("Risk Reasoning", risk_reasoning, "Risk reasoning completed"))

        # --- Verification ------------------------------------------------
        verification = self.verifier.verify(
            sentiment=sentiment,
            prediction=prediction if prediction.get("dataAvailable", True) else None,
            risk=risk if risk.get("dataAvailable", True) else None,
            market=market if market.get("dataAvailable", True) else None,
        )
        agent_logs.append(self._log("Verification", verification, "Verification completed"))

        # --- Recommendation Generator (weighted) ------------------------
        recommendation = self._build_recommendation(
            ticker=ticker,
            budget=budget,
            risk_profile=risk_profile,
            sentiment=sentiment,
            prediction=prediction,
            risk=risk,
            risk_reasoning=risk_reasoning,
            verification=verification,
        )

        # --- Explanation --------------------------------------------------
        explanation = self.explainer.explain(
            ticker=ticker,
            recommendation=recommendation,
            sentiment=sentiment,
            market=market,
            prediction=prediction if prediction.get("dataAvailable", True) else None,
            risk=risk if risk.get("dataAvailable", True) else None,
            verification=verification,
        )
        agent_logs.append(self._log("Explanation", explanation, "Explanation completed"))

        return {
            "query": user_query,
            "ticker": ticker,
            "version": requested_version,
            "pipeline": "full",
            "disclaimer": self.DISCLAIMER,
            "plan": plan,
            "market": market,
            "verification": verification,
            "riskReasoning": risk_reasoning,
            "dataAvailability": {
                "sentiment": sentiment.get("dataAvailable", True),
                "market": market.get("dataAvailable", True),
                "prediction": prediction.get("dataAvailable", True),
                "risk": risk.get("dataAvailable", True),
            },
            "sentiment": {
                "level": sentiment["level"],
                "score": sentiment["score"],
                "confidence": sentiment["confidence"],
                "dataAvailable": sentiment.get("dataAvailable", True),
                "resources": sentiment.get("resources", []),
                "timeline": sentiment.get("timeline"),
                "searchStats": sentiment.get("searchStats"),
                "searchAttempts": sentiment.get("searchAttempts", []),
                "reasoning": sentiment.get("reasoning", []),
                "synthesis": sentiment.get("synthesis"),
            },
            "prediction": prediction,
            "risk": risk,
            "recommendation": recommendation,
            "explanation": explanation,
            "agentLogs": agent_logs,
        }

    def _log(self, name: str, output: dict, default_message: str) -> Dict:
        return {
            "agent": name,
            "state": "completed",
            "durationMs": output.get("durationMs"),
            "message": output.get("message", default_message),
        }

    def _build_recommendation(
        self,
        ticker: str,
        budget: float,
        risk_profile: str,
        sentiment: dict,
        prediction: dict,
        risk: dict,
        risk_reasoning: dict,
        verification: dict,
    ) -> dict:
        """Combines every upstream agent's output into a single weighted
        buy score and action. Every contribution is logged to
        `decisionTrace` so the number is auditable, not a black box.

        If both sentiment and prediction are unavailable (both live data
        sources failed), there is no evidence to base a recommendation on
        -- this returns an explicit `insufficient_data` verdict rather
        than guessing.
        """
        decision_trace: List[Dict] = []

        sentiment_available = sentiment.get("dataAvailable", True)
        prediction_available = prediction.get("dataAvailable", True)
        risk_available = risk.get("dataAvailable", True)

        if not sentiment_available and not prediction_available:
            return {
                "action": "hold",
                "reason": (
                    f"No live news or market data was available for {ticker}. "
                    "No recommendation is made rather than guessing from missing evidence."
                ),
                "suggestedAmount": 0.0,
                "buyScore": None,
                "buyThreshold": BUY_THRESHOLD,
                "verdict": "insufficient_data",
                "decisionTrace": [
                    {
                        "stage": "Recommendation Generator",
                        "detail": "Both Researcher and Analyst reported dataAvailable=False.",
                        "outcome": "Returned insufficient_data instead of a fabricated recommendation.",
                    }
                ],
            }

        buy_score = 50.0

        if sentiment_available:
            sentiment_points = (sentiment.get("score", 0.5) - 0.5) * 2 * SENTIMENT_WEIGHT_POINTS
            buy_score += sentiment_points
            decision_trace.append(
                {
                    "stage": "Researcher",
                    "detail": (
                        f"Sentiment={sentiment.get('level', 'HOLD')} "
                        f"(score={round(sentiment.get('score', 0.5), 3)}, confidence={sentiment.get('confidence', 0.5)})."
                    ),
                    "outcome": f"Adjusted buy score by {round(sentiment_points, 2)} points.",
                }
            )
        else:
            decision_trace.append(
                {
                    "stage": "Researcher",
                    "detail": "No live news data available.",
                    "outcome": "Sentiment excluded from buy score (0 points contributed).",
                }
            )

        predicted_return = 0.0
        prediction_confidence = 0.5
        backtest_accuracy = 50.0
        if prediction_available:
            predicted_return = prediction.get("predictedReturnPct", 0.0) or 0.0
            prediction_confidence = prediction.get("confidence", 0.5) or 0.5
            query_alignment = prediction.get("queryAlignment", 0.5) or 0.5
            backtest_accuracy = (prediction.get("backtest") or {}).get("directionalAccuracyPct", 50.0)

            confidence_multiplier = max(0.5, min(1.2, prediction_confidence + query_alignment * 0.35))
            prediction_points = max(
                -PREDICTION_WEIGHT_POINTS,
                min(PREDICTION_WEIGHT_POINTS, predicted_return * 4 * confidence_multiplier),
            )
            buy_score += prediction_points
            decision_trace.append(
                {
                    "stage": "Analyst",
                    "detail": (
                        f"Predicted return={round(predicted_return, 2)}%, confidence={round(prediction_confidence, 2)}, "
                        f"query alignment={round(query_alignment, 2)}, backtest accuracy={round(backtest_accuracy, 1)}%."
                    ),
                    "outcome": f"Adjusted buy score by {round(prediction_points, 2)} points.",
                }
            )
        else:
            decision_trace.append(
                {
                    "stage": "Analyst",
                    "detail": "No usable price history; prediction was skipped.",
                    "outcome": "Prediction excluded from buy score (0 points contributed).",
                }
            )

        risk_level = risk.get("level", "medium") if risk_available else "unknown"
        risk_penalty = {
            "high": RISK_HIGH_PENALTY,
            "medium": RISK_MEDIUM_PENALTY,
            "low": RISK_LOW_PENALTY,
        }.get(risk_level, RISK_MEDIUM_PENALTY)
        buy_score -= risk_penalty
        decision_trace.append(
            {
                "stage": "Risk Manager",
                "detail": (
                    f"Risk level={risk_level}, VaR={risk.get('valueAtRiskPct', 'n/a')}%, "
                    f"recommended position={risk.get('recommendedPositionSizePct', 'n/a')}%."
                    if risk_available
                    else "Risk Manager skipped (no prediction to size against)."
                ),
                "outcome": f"Applied risk penalty of {risk_penalty} points.",
            }
        )

        # Risk Reasoning: qualitative discount on top of the quantitative
        # Risk Manager output. This is the "what could invalidate this
        # prediction" adjustment described in the FINDEC v1 design.
        confidence_adjustment = risk_reasoning.get("confidenceAdjustment", 0.0) or 0.0
        position_size_adjustment = risk_reasoning.get("positionSizeAdjustment", 0.0) or 0.0
        if risk_reasoning.get("invalidatingFactors"):
            reasoning_penalty = abs(confidence_adjustment) * 40  # scale 0..0.3 -> 0..12 points
            buy_score -= reasoning_penalty
            decision_trace.append(
                {
                    "stage": "Risk Reasoning",
                    "detail": f"{len(risk_reasoning['invalidatingFactors'])} invalidating factor(s) found: "
                    + "; ".join(risk_reasoning["invalidatingFactors"][:3]),
                    "outcome": f"Applied additional penalty of {round(reasoning_penalty, 2)} points.",
                }
            )

        # Verification: conflicts between agents are a hard trust signal,
        # not just informational -- a conflict caps the score so the
        # system can't confidently BUY/SELL on contradictory evidence.
        if verification.get("status") == "conflict":
            buy_score = max(SELL_THRESHOLD + 1, min(BUY_THRESHOLD - 1, buy_score))
            decision_trace.append(
                {
                    "stage": "Verification",
                    "detail": f"Conflicting signals detected: {'; '.join(verification.get('conflicts', [])[:2])}.",
                    "outcome": "Buy score capped inside the HOLD band; BUY/SELL not allowed on conflicting evidence.",
                }
            )

        buy_score = max(0.0, min(100.0, round(buy_score, 2)))

        if buy_score >= BUY_THRESHOLD and prediction_confidence >= MIN_PREDICTION_CONFIDENCE_FOR_BUY and backtest_accuracy >= MIN_BACKTEST_ACCURACY_FOR_BUY:
            action = "buy"
        elif buy_score <= SELL_THRESHOLD:
            action = "sell"
        else:
            action = "hold"

        if risk_available and risk_level == "high":
            action = "hold" if action == "buy" else action
            decision_trace.append(
                {
                    "stage": "Risk Override",
                    "detail": "Risk level is high.",
                    "outcome": "BUY suppressed regardless of buy score; action forced to HOLD or SELL only.",
                }
            )

        base_size_pct = SIZE_PCT_BY_RISK_PROFILE.get(risk_profile, 0.1)
        if risk_available and risk.get("recommendedPositionSizePct") is not None:
            base_size_pct = risk["recommendedPositionSizePct"] / 100
        size_pct = max(0.0, base_size_pct * (1 + position_size_adjustment))

        verdict = "buy_now" if action == "buy" else "wait" if action == "hold" else "avoid"
        decision_trace.append(
            {
                "stage": "Final Decision",
                "detail": f"Buy score={buy_score} vs buy threshold={BUY_THRESHOLD}, sell threshold={SELL_THRESHOLD}.",
                "outcome": f"Final verdict={verdict}, action={action}.",
            }
        )

        suggested_amount = round(max(0.0, budget * size_pct), 2) if action == "buy" else 0.0

        return {
            "action": action,
            "reason": (
                f"Weighted combination of Researcher sentiment, Analyst prediction, Risk Manager sizing, "
                f"Risk Reasoning adjustments, and Verification status for {ticker}."
            ),
            "suggestedAmount": suggested_amount,
            "buyScore": buy_score,
            "buyThreshold": BUY_THRESHOLD,
            "sellThreshold": SELL_THRESHOLD,
            "verdict": verdict,
            "decisionTrace": decision_trace,
        }
