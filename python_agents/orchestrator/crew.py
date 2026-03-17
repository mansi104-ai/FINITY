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
                "label": sentiment["label"],
                "score": sentiment["score"],
                "confidence": sentiment["confidence"],
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

        if version == 1:
            action = "buy" if sentiment_score > 0.62 else "hold" if sentiment_score > 0.45 else "sell"
            size_pct = 0.05
            reason = "Version 1 uses news sentiment only."
        elif version == 2:
            predicted_return = prediction.get("predictedReturnPct", 0.0) if prediction else 0.0
            if predicted_return >= 2 and sentiment_score >= 0.55:
                action = "buy"
            elif predicted_return <= -1 and sentiment_score < 0.5:
                action = "sell"
            else:
                action = "hold"
            size_pct = 0.08
            reason = "Version 2 combines sentiment and analyst forecast."
        elif version == 3:
            predicted_return = prediction.get("predictedReturnPct", 0.0) if prediction else 0.0
            bias = predicted_return * 0.6 + (sentiment_score - 0.5) * 10
            if bias > 1.5:
                action = "buy"
            elif bias < -1.5:
                action = "sell"
            else:
                action = "hold"
            size_pct = {"low": 0.06, "medium": 0.1, "high": 0.14}.get(risk_profile, 0.1)
            reason = "Version 3 adds backend policy and user risk profile weighting."
        else:
            risk_pct = (risk or {}).get("recommendedPositionSizePct", 8.0) / 100
            if risk and risk.get("level") == "high":
                action = "hold"
            else:
                predicted_return = prediction.get("predictedReturnPct", 0.0) if prediction else 0.0
                if predicted_return >= 2 and sentiment_score >= 0.55:
                    action = "buy"
                elif predicted_return <= -2:
                    action = "sell"
                else:
                    action = "hold"
            size_pct = risk_pct
            reason = "Version 4 uses full multi-agent orchestration including risk control."

        suggested_amount = round(max(0.0, budget * size_pct), 2)

        return {
            "action": action,
            "reason": f"{reason} Suggested allocation for {ticker} is based on current signals.",
            "suggestedAmount": suggested_amount,
        }
