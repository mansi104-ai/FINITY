import time

SIGMA_REF = 0.03
DRAWDOWN_REF = 0.15
RISK_WEIGHTS = {
    "low": (0.2, 0.8),
    "medium": (0.5, 0.5),
    "high": (0.8, 0.2),
}
RSI_OVERSOLD = 30
RSI_OVERBOUGHT = 70

try:
    from ..risk.var_calculator import calculate_var
except Exception:
    try:
        from risk.var_calculator import calculate_var
    except ModuleNotFoundError:
        from python_agents.risk.var_calculator import calculate_var


class RiskManagerAgent:
    """Quantitative risk: Value-at-Risk + position sizing.

    Reports `dataAvailable: False` (rather than a made-up VaR) whenever
    either the upstream prediction or the VaR calculation itself lacked
    enough real data. See risk/var_calculator.py for why the previous
    synthetic-returns fallback was removed.
    """

    POSITION_MAP = {
        "low": 0.06,
        "medium": 0.1,
        "high": 0.16,
    }

    def evaluate(self, ticker: str, budget: float, risk_profile: str, prediction: dict) -> dict:
        start = time.perf_counter()

        if not prediction or prediction.get("dataAvailable") is False:
            return {
                "dataAvailable": False,
                "valueAtRiskPct": None,
                "level": "unknown",
                "recommendedPositionSizePct": 0.0,
                "message": f"Skipped risk evaluation for {ticker}: no prediction available (missing market data).",
                "durationMs": int((time.perf_counter() - start) * 1000),
            }

        var = calculate_var(ticker=ticker, position_value=budget)

        if not var.get("dataAvailable", False):
            return {
                "dataAvailable": False,
                "valueAtRiskPct": None,
                "level": "unknown",
                "recommendedPositionSizePct": 0.0,
                "message": (
                    f"Skipped risk evaluation for {ticker}: {var.get('message', 'VaR could not be computed.')}"
                ),
                "durationMs": int((time.perf_counter() - start) * 1000),
            }

        max_position_pct = self.POSITION_MAP.get(risk_profile, 0.1) * 100
        risk_level = self._risk_level(var_pct=var["var_pct"], base_limit=max_position_pct)

        var_penalty = min(var["var_pct"] / 100 * 2.2, 0.08)
        recommended_pct = max(2.0, max_position_pct * (1 - var_penalty))

        return {
            "dataAvailable": True,
            "valueAtRiskPct": round(var["var_pct"], 2),
            "valueAtRiskUsd": var.get("var_usd"),
            "volatilityPct": var.get("volatility_pct"),
            "varObservationCount": var.get("observationCount"),
            "level": risk_level,
            "recommendedPositionSizePct": round(recommended_pct, 2),
            "message": (
                f"VaR computed from {var.get('observationCount', 0)} historical daily returns. "
                f"Risk refs sigma={SIGMA_REF}, drawdown={DRAWDOWN_REF}, RSI band {RSI_OVERSOLD}-{RSI_OVERBOUGHT}."
            ),
            "durationMs": int((time.perf_counter() - start) * 1000),
        }

    def _risk_level(self, var_pct: float, base_limit: float) -> str:
        if var_pct < base_limit * 0.45:
            return "low"
        if var_pct < base_limit * 0.8:
            return "medium"
        return "high"
