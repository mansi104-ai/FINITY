import time

try:
    from risk.var_calculator import calculate_var
except ModuleNotFoundError:
    from python_agents.risk.var_calculator import calculate_var


class RiskManagerAgent:
    POSITION_MAP = {
        "low": 0.06,
        "medium": 0.1,
        "high": 0.16,
    }

    def evaluate(self, ticker: str, budget: float, risk_profile: str, prediction: dict) -> dict:
        start = time.perf_counter()
        var = calculate_var(ticker=ticker, position_value=budget)

        max_position_pct = self.POSITION_MAP.get(risk_profile, 0.1) * 100
        risk_level = self._risk_level(var_pct=var["var_pct"], base_limit=max_position_pct)

        var_penalty = min(var["var_pct"] / 100 * 2.2, 0.08)
        recommended_pct = max(2.0, max_position_pct * (1 - var_penalty))

        return {
            "valueAtRiskPct": round(var["var_pct"], 2),
            "level": risk_level,
            "recommendedPositionSizePct": round(recommended_pct, 2),
            "message": "VaR computed with 90-day historical returns",
            "durationMs": int((time.perf_counter() - start) * 1000),
        }

    def _risk_level(self, var_pct: float, base_limit: float) -> str:
        if var_pct < base_limit * 0.45:
            return "low"
        if var_pct < base_limit * 0.8:
            return "medium"
        return "high"
