from agents.researcher import ResearcherAgent
from agents.analyst import AnalystAgent
from agents.risk_manager import RiskManagerAgent

class FinanceCrew:
    def __init__(self):
        self.researcher   = ResearcherAgent()
        self.analyst      = AnalystAgent()
        self.risk_manager = RiskManagerAgent()

    def run(self, query: dict) -> dict:
        ticker       = query["ticker"]
        budget       = query["budget"]
        risk_profile = query["risk_profile"]

        # Step 1: Sentiment
        sentiment = self.researcher.analyze(ticker)

        # Step 2: Price prediction
        prediction = self.analyst.predict(ticker)

        # Step 3: Risk check
        risk = self.risk_manager.evaluate(
            ticker, budget, risk_profile, prediction
        )

        return {
            "ticker":     ticker,
            "sentiment":  sentiment,
            "prediction": prediction,
            "risk":       risk,
            "advice":     risk["advice"]
        }