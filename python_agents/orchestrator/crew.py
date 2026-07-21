"""Orchestrator (FINDEC v1 -- full agentic pipeline, with adaptive
agent-reliability weighting).

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
              Recommendation Generator (reliability-weighted)
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

Agent Reliability
------------------
Fixed weights (e.g. "sentiment always moves the score by up to 40
points") assume every agent is equally trustworthy in every situation,
which isn't true -- a Ridge-based Analyst is measurably less accurate in
high-volatility regimes than in calm ones, and the Researcher is only as
good as the news coverage that exists for a given ticker. Each agent's
per-request contribution weight is now scaled by a reliability score
tracked in services/reliability.py: a Bayesian-smoothed, per-context
(volatility regime) trust score built from that agent's own real,
measured outcomes on *previous* requests (backtest accuracy for the
Analyst, data-availability + confidence for the Researcher, successful
VaR computation for the Risk Manager). This is what makes the system
adaptive rather than statically weighted, per the FINDEC v1 design.
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
    from ..services.reliability import get_reliability_store, volatility_context, blended_reliability
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
        from services.reliability import get_reliability_store, volatility_context, blended_reliability
    except ModuleNotFoundError:
        from python_agents.agents.analyst import AnalystAgent
        from python_agents.agents.researcher import ResearcherAgent
        from python_agents.agents.risk_manager import RiskManagerAgent
        from python_agents.agents.planner import PlannerAgent
        from python_agents.agents.market_agent import MarketAgent
        from python_agents.agents.verification import VerificationAgent
        from python_agents.agents.explanation import ExplanationAgent
        from python_agents.agents.risk_reasoning import RiskReasoningAgent
        from python_agents.services.reliability import get_reliability_store, volatility_context, blended_reliability


# Weighting constants for the Recommendation Generator. Kept as named
# module-level constants (rather than magic numbers inline) so the paper /
# docs can cite exactly how the buy score is built. These are the BASE
# weights before the reliability multiplier from `blended_reliability` is
# applied (see RELIABILITY_MULTIPLIER_* below).
SENTIMENT_WEIGHT_POINTS = 40.0        # weight of the Researcher sentiment sub-score
PREDICTION_WEIGHT_POINTS = 22.0       # weight of the Analyst prediction sub-score (tuned out-of-sample)
RISK_HIGH_PENALTY = 20.0
RISK_MEDIUM_PENALTY = 8.0
RISK_LOW_PENALTY = 0.0

BUY_THRESHOLD = 63.0
SELL_THRESHOLD = 37.0

MIN_PREDICTION_CONFIDENCE_FOR_BUY = 0.55
MIN_BACKTEST_ACCURACY_FOR_BUY = 52.0

SIZE_PCT_BY_RISK_PROFILE = {"low": 0.06, "medium": 0.1, "high": 0.16}

# --- Evidence-renormalization decision model -----------------------------
# The buy score is a reliability-weighted average of ONLY the sub-scores whose
# evidence is actually available, each in [0, 100] with 50 = neutral. This is
# the fix for the old additive-from-50 model, where a strong Analyst prediction
# could not move a 50-anchored score far enough to act whenever Researcher
# sentiment was missing (news APIs down, or a reproducible offline backtest that
# can't replay historical news). Now a missing signal cedes its weight to the
# others instead of pinning the score at neutral.
PREDICTION_REFERENCE_PCT = 1.4   # predicted return (%) that maps to full bullish conviction
PRED_CONF_FLOOR = 0.45           # fraction of prediction conviction retained at lowest confidence
SENTIMENT_CONF_REF = 0.6         # sentiment confidence that maps to full sentiment conviction
# Trend/regime sub-score: a robust momentum signal (price vs its own recent mean)
# that participates in the weighted buy score alongside the Analyst prediction.
# This is the main lever for beating buy&hold on Sharpe: it keeps the overlay
# invested through uptrends and flat through sustained downtrends, where the
# short-horizon prediction alone is too noisy to time either reliably. The
# prediction still supplies the alpha tilt on top of the trend.
TREND_WEIGHT_POINTS = 80.0       # weight of the trend sub-score (tuned out-of-sample; trend
                                 # is the most reliable timing signal given the model's modest
                                 # short-horizon directional edge, so it dominates the blend)
TREND_REFERENCE_PCT = 0.05       # distance from the trend mean mapping to full conviction
REGIME_LOOKBACK = 30             # trading days used for the trend mean
# Risk level dampens above-neutral conviction multiplicatively (the hard "risk
# high -> suppress BUY" override still applies separately below).
RISK_SCORE_DAMPEN = {"high": 0.55, "medium": 0.85, "low": 1.0}

# Reliability score of 0.75 (the prior) maps to a 1.0x multiplier -- an
# agent with no track record yet gets exactly the base weight. Evidence of
# being more/less reliable than the prior scales the multiplier, clamped
# so one bad or good streak can't zero out or double an agent's voice.
RELIABILITY_PRIOR = 0.75
RELIABILITY_MULTIPLIER_MIN = 0.6
RELIABILITY_MULTIPLIER_MAX = 1.3


def _reliability_multiplier(reliability_score: float) -> float:
    raw = reliability_score / RELIABILITY_PRIOR
    return max(RELIABILITY_MULTIPLIER_MIN, min(RELIABILITY_MULTIPLIER_MAX, raw))


def _trend_subscore(prediction: dict):
    """Trend/regime sub-score in [0, 100] (50 = neutral) from the prediction's
    own recent price history: how far current price sits above/below its
    REGIME_LOOKBACK-day mean, normalized by TREND_REFERENCE_PCT. Above the mean
    (uptrend) -> bullish (>50); below (downtrend) -> bearish (<50).

    Returns (subscore, trend_ratio) or (None, 0.0) when there isn't enough
    history. Pure-Python (crew.py stays dependency-light) and uses only the
    trailing closes already carried on the prediction payload, so it adds no new
    data dependency and no lookahead in the backtest.
    """
    history = prediction.get("history") or []
    if len(history) < 10:
        return None, 0.0
    window = history[-REGIME_LOOKBACK:]
    mean_price = sum(window) / len(window)
    if mean_price <= 0:
        return None, 0.0
    trend_ratio = history[-1] / mean_price - 1.0
    conviction = max(-1.0, min(1.0, trend_ratio / TREND_REFERENCE_PCT))
    return 50.0 + conviction * 50.0, trend_ratio


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
        self.reliability = get_reliability_store()
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

        # Reliability context: bucket by the market's realized-volatility
        # regime. Read BEFORE recording this run's outcomes, so today's
        # weighting reflects prior evidence only, never this request's own
        # result feeding back into itself.
        context = volatility_context(market.get("volatilityPct"))

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

        # --- Agent Reliability: read current trust scores, then record
        #     this run's outcome for future requests ---------------------
        reliability_snapshot = self._read_reliability(context=context)
        self._record_reliability_outcomes(context=context, sentiment=sentiment, prediction=prediction, risk=risk, market=market)

        # --- Recommendation Generator (reliability-weighted) ------------
        recommendation = self._build_recommendation(
            ticker=ticker,
            budget=budget,
            risk_profile=risk_profile,
            sentiment=sentiment,
            prediction=prediction,
            risk=risk,
            risk_reasoning=risk_reasoning,
            verification=verification,
            reliability=reliability_snapshot,
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
            "agentReliability": {
                "context": context,
                "agents": reliability_snapshot,
            },
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

    # --- Agent Reliability -------------------------------------------------

    def _read_reliability(self, context: str) -> Dict[str, Dict]:
        """Reads each scored agent's current blended (context + overall)
        reliability. Called once per request, before this request's own
        outcomes are recorded, so the weighting is never self-referential.
        """
        agents = ["ResearcherAgent", "AnalystAgent", "RiskManagerAgent", "MarketAgent"]
        return {agent: blended_reliability(self.reliability, agent, context) for agent in agents}

    def _record_reliability_outcomes(
        self, context: str, sentiment: dict, prediction: dict, risk: dict, market: dict
    ) -> None:
        """Turns each agent's own output into a quality signal in [0, 1]
        and records it for both the "overall" bucket and this request's
        volatility-regime bucket. See services/reliability.py for how
        these accumulate into a smoothed trust score.
        """
        # Researcher: rewards actually retrieving live news (not just
        # returning a HOLD default) and being confident about it, with a
        # small bonus for having enough resources to be more than a
        # single-article call.
        if sentiment.get("dataAvailable", False):
            resource_bonus = min(1.0, len(sentiment.get("resources", [])) / 5.0)
            researcher_quality = max(0.0, min(1.0, float(sentiment.get("confidence", 0.5)) * 0.7 + resource_bonus * 0.3))
        else:
            researcher_quality = 0.0
        self._record_both(agent="ResearcherAgent", context=context, quality=researcher_quality)

        # Analyst: the walk-forward backtest's directional accuracy is a
        # genuinely measured number produced fresh on every request (not a
        # guess), so it is a direct, honest quality signal.
        if prediction.get("dataAvailable", False):
            backtest = prediction.get("backtest") or {}
            accuracy_pct = backtest.get("directionalAccuracyEnsemblePct", backtest.get("directionalAccuracyPct", 50.0))
            analyst_quality = max(0.0, min(1.0, float(accuracy_pct) / 100.0))
        else:
            analyst_quality = 0.0
        self._record_both(agent="AnalystAgent", context=context, quality=analyst_quality)

        # Risk Manager: rewards successfully computing a real VaR from
        # enough historical returns, scaled up as observations increase.
        if risk.get("dataAvailable", False):
            observations = risk.get("varObservationCount") or 0
            risk_quality = max(0.4, min(1.0, observations / 90.0))
        else:
            risk_quality = 0.0
        self._record_both(agent="RiskManagerAgent", context=context, quality=risk_quality)

        # Market Agent: rewards successfully retrieving live (non-stale,
        # non-"unavailable") price history.
        market_quality = 1.0 if market.get("dataAvailable", False) and "stale" not in (market.get("dataSource") or "") else (
            0.5 if market.get("dataAvailable", False) else 0.0
        )
        self._record_both(agent="MarketAgent", context=context, quality=market_quality)

    def _record_both(self, agent: str, context: str, quality: float) -> None:
        self.reliability.record(agent=agent, context="overall", quality=quality)
        if context != "overall":
            self.reliability.record(agent=agent, context=context, quality=quality)

    # --- Recommendation Generator -------------------------------------------

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
        reliability: Dict[str, Dict],
    ) -> dict:
        """Combines every upstream agent's output into a single weighted
        buy score and action. Every contribution is logged to
        `decisionTrace` so the number is auditable, not a black box.

        Each agent's contribution is scaled by its current reliability
        multiplier (see `_reliability_multiplier`), so an agent that has
        been reporting low-quality evidence (e.g. thin news coverage, a
        poorly-calibrated backtest in this volatility regime) has
        proportionally less influence on the score than one with a strong
        track record -- this is the adaptive weighting described in the
        FINDEC v1 design, replacing static fixed weights.

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

        researcher_reliability = reliability.get("ResearcherAgent", {})
        researcher_multiplier = _reliability_multiplier(researcher_reliability.get("score", RELIABILITY_PRIOR))
        analyst_reliability = reliability.get("AnalystAgent", {})
        analyst_multiplier = _reliability_multiplier(analyst_reliability.get("score", RELIABILITY_PRIOR))

        # Each available signal contributes a sub-score in [0, 100] (50 = neutral),
        # weighted by its base weight * reliability multiplier. The buy score is the
        # weighted average over ONLY the available signals (see the decision-model
        # constants above), so a missing signal cedes its weight instead of pinning
        # the score at neutral.
        weighted_sum = 0.0
        weight_total = 0.0

        if sentiment_available:
            sent_conviction = (sentiment.get("score", 0.5) - 0.5) * 2  # [-1, 1]
            sent_conf = float(sentiment.get("confidence", 0.5) or 0.5)
            sent_conviction *= min(1.0, sent_conf / SENTIMENT_CONF_REF)  # damp low-confidence sentiment
            sentiment_subscore = 50.0 + sent_conviction * 50.0
            sentiment_weight = SENTIMENT_WEIGHT_POINTS * researcher_multiplier
            weighted_sum += sentiment_subscore * sentiment_weight
            weight_total += sentiment_weight
            decision_trace.append(
                {
                    "stage": "Researcher",
                    "detail": (
                        f"Sentiment={sentiment.get('level', 'HOLD')} "
                        f"(score={round(sentiment.get('score', 0.5), 3)}, confidence={round(sent_conf, 2)}). "
                        f"Reliability={researcher_reliability.get('score', RELIABILITY_PRIOR)} "
                        f"(n={researcher_reliability.get('sampleSize', 0)}, context={researcher_reliability.get('context', 'overall')}) "
                        f"-> weight {round(sentiment_weight, 1)}."
                    ),
                    "outcome": f"Sub-score {round(sentiment_subscore, 1)}/100 (50=neutral).",
                }
            )
        else:
            decision_trace.append(
                {
                    "stage": "Researcher",
                    "detail": "No live news data available.",
                    "outcome": "Sentiment excluded; its weight cedes to the remaining signals.",
                }
            )

        prediction_confidence = 0.5
        backtest_accuracy = 50.0
        if prediction_available:
            predicted_return = prediction.get("predictedReturnPct", 0.0) or 0.0
            prediction_confidence = prediction.get("confidence", 0.5) or 0.5
            query_alignment = prediction.get("queryAlignment", 0.5) or 0.5
            backtest_accuracy = (prediction.get("backtest") or {}).get("directionalAccuracyPct", 50.0)

            raw_conviction = max(-1.0, min(1.0, predicted_return / PREDICTION_REFERENCE_PCT))
            conf_factor = max(0.0, min(1.0, (prediction_confidence - 0.5) / 0.4))
            conviction_scale = PRED_CONF_FLOOR + (1.0 - PRED_CONF_FLOOR) * conf_factor
            conviction_scale *= (0.85 + 0.15 * query_alignment)  # small nudge for on-topic queries
            prediction_conviction = raw_conviction * conviction_scale
            prediction_subscore = 50.0 + prediction_conviction * 50.0
            prediction_weight = PREDICTION_WEIGHT_POINTS * analyst_multiplier
            weighted_sum += prediction_subscore * prediction_weight
            weight_total += prediction_weight
            decision_trace.append(
                {
                    "stage": "Analyst",
                    "detail": (
                        f"Predicted return={round(predicted_return, 2)}%, confidence={round(prediction_confidence, 2)}, "
                        f"query alignment={round(query_alignment, 2)}, backtest accuracy={round(backtest_accuracy, 1)}%. "
                        f"Reliability={analyst_reliability.get('score', RELIABILITY_PRIOR)} "
                        f"(n={analyst_reliability.get('sampleSize', 0)}, context={analyst_reliability.get('context', 'overall')}) "
                        f"-> weight {round(prediction_weight, 1)}."
                    ),
                    "outcome": f"Sub-score {round(prediction_subscore, 1)}/100 (50=neutral).",
                }
            )
        else:
            decision_trace.append(
                {
                    "stage": "Analyst",
                    "detail": "No usable price history; prediction was skipped.",
                    "outcome": "Prediction excluded; its weight cedes to the remaining signals.",
                }
            )

        # Trend/regime sub-score: a robust momentum signal that participates in the
        # weighted average (keeps the overlay invested in uptrends, flat in
        # downtrends -- the main Sharpe lever). Needs the prediction payload's
        # trailing closes, so it only contributes when a prediction is available.
        trend_ratio = 0.0
        if prediction_available:
            trend_subscore, trend_ratio = _trend_subscore(prediction)
            if trend_subscore is not None:
                weighted_sum += trend_subscore * TREND_WEIGHT_POINTS
                weight_total += TREND_WEIGHT_POINTS
                decision_trace.append(
                    {
                        "stage": "Trend Filter",
                        "detail": f"Price is {round(trend_ratio * 100, 1)}% vs its {REGIME_LOOKBACK}-day mean.",
                        "outcome": f"Sub-score {round(trend_subscore, 1)}/100 (weight {TREND_WEIGHT_POINTS}).",
                    }
                )

        buy_score = weighted_sum / weight_total if weight_total > 0 else 50.0

        risk_level = risk.get("level", "medium") if risk_available else "unknown"
        risk_dampen = RISK_SCORE_DAMPEN.get(risk_level, RISK_SCORE_DAMPEN["medium"])
        if buy_score > 50.0 and risk_dampen < 1.0:
            damped = 50.0 + (buy_score - 50.0) * risk_dampen
            decision_trace.append(
                {
                    "stage": "Risk Manager",
                    "detail": (
                        f"Risk level={risk_level}, VaR={risk.get('valueAtRiskPct', 'n/a')}%, "
                        f"recommended position={risk.get('recommendedPositionSizePct', 'n/a')}%."
                    ),
                    "outcome": f"Bullish conviction dampened {risk_dampen}x: {round(buy_score, 1)} -> {round(damped, 1)}.",
                }
            )
            buy_score = damped
        else:
            decision_trace.append(
                {
                    "stage": "Risk Manager",
                    "detail": (
                        f"Risk level={risk_level}, VaR={risk.get('valueAtRiskPct', 'n/a')}%, "
                        f"recommended position={risk.get('recommendedPositionSizePct', 'n/a')}%."
                        if risk_available
                        else "Risk Manager skipped (no prediction to size against, or VaR could not be computed)."
                    ),
                    "outcome": "No downward risk adjustment applied.",
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
                f"Reliability-weighted combination of Researcher sentiment, Analyst prediction, Risk Manager sizing, "
                f"Risk Reasoning adjustments, and Verification status for {ticker}."
            ),
            "suggestedAmount": suggested_amount,
            "buyScore": buy_score,
            "buyThreshold": BUY_THRESHOLD,
            "sellThreshold": SELL_THRESHOLD,
            "verdict": verdict,
            "decisionTrace": decision_trace,
        }
