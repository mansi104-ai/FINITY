from typing import Dict, List, Optional

try:
    from agents.analyst import AnalystAgent
    from agents.researcher import ResearcherAgent
    from agents.risk_manager import RiskManagerAgent
except ModuleNotFoundError:
    from python_agents.agents.analyst import AnalystAgent
    from python_agents.agents.researcher import ResearcherAgent
    from python_agents.agents.risk_manager import RiskManagerAgent


class FinanceCrew:
    def __init__(self) -> None:
        self.researcher = ResearcherAgent()
        self.analyst = AnalystAgent()
        self.risk_manager = RiskManagerAgent()

    def run(self, query: dict) -> dict:
        ticker = query["ticker"].upper()
        user_query = query["query"]
        budget = float(query["budget"])
        risk_profile = str(query.get("risk_profile", "medium")).lower()
        version = int(query.get("version", 4))

        risk_profile = {
            "conservative": "low",
            "moderate": "medium",
            "aggressive": "high",
        }.get(risk_profile, risk_profile)

        agent_logs: List[Dict] = []

        sentiment = self.researcher.analyze(ticker=ticker, query=user_query)
        agent_logs.append(
            {
                "agent": "Researcher",
                "state": "completed",
                "durationMs": sentiment.get("durationMs"),
                "message": sentiment.get("message", "Sentiment completed"),
            }
        )

        prediction: Optional[dict] = None
        risk: Optional[dict] = None

        if version >= 2:
            prediction = self.analyst.predict(ticker=ticker)
            agent_logs.append(
                {
                    "agent": "Analyst",
                    "state": "completed",
                    "durationMs": prediction.get("durationMs"),
                    "message": prediction.get("message", "Prediction completed"),
                }
            )

        if version >= 4 and prediction is not None:
            risk = self.risk_manager.evaluate(
                ticker=ticker,
                budget=budget,
                risk_profile=risk_profile,
                prediction=prediction,
            )
            agent_logs.append(
                {
                    "agent": "Risk Manager",
                    "state": "completed",
                    "durationMs": risk.get("durationMs"),
                    "message": risk.get("message", "Risk evaluation completed"),
                }
            )

        recommendation = self._build_recommendation(
            ticker=ticker,
            budget=budget,
            risk_profile=risk_profile,
            version=version,
            sentiment=sentiment,
            prediction=prediction,
            risk=risk,
        )

        return {
            "query": user_query,
            "ticker": ticker,
            "version": version,
            "sentiment": {
                "level": sentiment["level"],
                "score": sentiment["score"],
                "confidence": sentiment["confidence"],
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
            "agentLogs": agent_logs,
        }

    def _build_recommendation(
        self,
        ticker: str,
        budget: float,
        risk_profile: str,
        version: int,
        sentiment: dict,
        prediction: Optional[dict],
        risk: Optional[dict],
    ) -> dict:
        sentiment_score = sentiment.get("score", 0.5)
        decision_trace: List[Dict] = []
        buy_score = 50.0

        sentiment_points = (sentiment_score - 0.5) * 80
        buy_score += sentiment_points
        decision_trace.append(
            {
                "stage": "Researcher",
                "detail": (
                    f"Sentiment={sentiment.get('level', 'HOLD')} "
                    f"(score={round(sentiment_score, 3)}, confidence={sentiment.get('confidence', 0.5)})."
                ),
                "outcome": f"Adjusted buy score by {round(sentiment_points, 2)} points.",
            }
        )

        if version == 1:
            action = "buy" if sentiment_score > 0.62 else "hold" if sentiment_score > 0.45 else "sell"
            size_pct = 0.05
            reason = "Version 1 uses news sentiment only."
            buy_threshold = 60.0
        elif version == 2:
            predicted_return = prediction.get("predictedReturnPct", 0.0) if prediction else 0.0
            prediction_points = max(-25.0, min(25.0, predicted_return * 4))
            buy_score += prediction_points
            decision_trace.append(
                {
                    "stage": "Analyst",
                    "detail": f"Predicted return={round(predicted_return, 2)}%.",
                    "outcome": f"Adjusted buy score by {round(prediction_points, 2)} points.",
                }
            )
            if predicted_return >= 2 and sentiment_score >= 0.55:
                action = "buy"
            elif predicted_return <= -1 and sentiment_score < 0.5:
                action = "sell"
            else:
                action = "hold"
            size_pct = 0.08
            reason = "Version 2 combines sentiment and analyst forecast."
            buy_threshold = 62.0
        elif version == 3:
            predicted_return = prediction.get("predictedReturnPct", 0.0) if prediction else 0.0
            prediction_points = max(-25.0, min(25.0, predicted_return * 4))
            buy_score += prediction_points
            decision_trace.append(
                {
                    "stage": "Analyst",
                    "detail": f"Predicted return={round(predicted_return, 2)}%.",
                    "outcome": f"Adjusted buy score by {round(prediction_points, 2)} points.",
                }
            )
            bias = predicted_return * 0.6 + (sentiment_score - 0.5) * 10
            if bias > 1.5:
                action = "buy"
            elif bias < -1.5:
                action = "sell"
            else:
                action = "hold"
            size_pct = {"low": 0.06, "medium": 0.1, "high": 0.14}.get(risk_profile, 0.1)
            reason = "Version 3 adds backend policy and user risk profile weighting."
            buy_threshold = 63.0
            decision_trace.append(
                {
                    "stage": "Policy",
                    "detail": f"Bias score={round(bias, 2)} with risk profile={risk_profile}.",
                    "outcome": f"Version 3 policy selected action={action}.",
                }
            )
        else:
            risk_pct = (risk or {}).get("recommendedPositionSizePct", 8.0) / 100
            risk_level = (risk or {}).get("level", "medium")
            risk_penalty = 20.0 if risk_level == "high" else 8.0 if risk_level == "medium" else 0.0
            buy_score -= risk_penalty
            decision_trace.append(
                {
                    "stage": "Risk Manager",
                    "detail": (
                        f"Risk level={risk_level}, VaR={(risk or {}).get('valueAtRiskPct', 'n/a')}%, "
                        f"recommended position={(risk or {}).get('recommendedPositionSizePct', 'n/a')}%."
                    ),
                    "outcome": f"Applied risk penalty of {risk_penalty} points.",
                }
            )
            if risk and risk.get("level") == "high":
                action = "hold"
            else:
                predicted_return = prediction.get("predictedReturnPct", 0.0) if prediction else 0.0
                prediction_points = max(-25.0, min(25.0, predicted_return * 4))
                buy_score += prediction_points
                decision_trace.append(
                    {
                        "stage": "Analyst",
                        "detail": f"Predicted return={round(predicted_return, 2)}%.",
                        "outcome": f"Adjusted buy score by {round(prediction_points, 2)} points.",
                    }
                )
                if predicted_return >= 2 and sentiment_score >= 0.55:
                    action = "buy"
                elif predicted_return <= -2:
                    action = "sell"
                else:
                    action = "hold"
            size_pct = risk_pct
            reason = "Version 4 uses full multi-agent orchestration including risk control."
            buy_threshold = 65.0

        buy_score = max(0.0, min(100.0, round(buy_score, 2)))
        verdict = "buy_now" if action == "buy" else "wait" if action == "hold" else "avoid"
        decision_trace.append(
            {
                "stage": "Final Decision",
                "detail": f"Buy score={buy_score} vs threshold={buy_threshold}.",
                "outcome": f"Final verdict={verdict} and action={action}.",
            }
        )
        suggested_amount = round(max(0.0, budget * size_pct), 2)

        return {
            "action": action,
            "reason": f"{reason} Suggested allocation for {ticker} is based on current signals.",
            "suggestedAmount": suggested_amount,
            "buyScore": buy_score,
            "buyThreshold": buy_threshold,
            "verdict": verdict,
            "decisionTrace": decision_trace,
        }
