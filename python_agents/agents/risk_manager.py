from risk.var_calculator import calculate_var
import os
from anthropic import Anthropic

client = Anthropic()

class RiskManagerAgent:
    RISK_LIMITS = {
        "conservative": 0.05,
        "moderate":     0.10,
        "aggressive":   0.20
    }

    def evaluate(self, ticker, budget, risk_profile, prediction) -> dict:
        var        = calculate_var(ticker, budget)
        limit      = self.RISK_LIMITS.get(risk_profile, 0.10)
        safe_amount = budget * limit
        blocked    = var["var_pct"] > limit * 1.5

        advice = self._generate_advice(
            ticker, budget, safe_amount, prediction, var, blocked
        )

        return {
            "var":          var,
            "safe_amount":  round(safe_amount, 2),
            "blocked":      blocked,
            "advice":       advice
        }

    def _generate_advice(self, ticker, budget, safe_amount,
                         prediction, var, blocked) -> str:
        # TODO: call Claude API to generate advice
        prompt = f"""
        Ticker: {ticker}, Budget: ${budget}, Safe amount: ${safe_amount}
        Prediction: {prediction}, VaR: {var}, Blocked: {blocked}
        Write a 3-sentence investment advice in plain English.
        """
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}]
        )
        return message.content[0].text