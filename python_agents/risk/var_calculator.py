import numpy as np

try:
    from ..models.market_data import MarketDataService
except Exception:
    try:
        from models.market_data import MarketDataService
    except ModuleNotFoundError:
        from python_agents.models.market_data import MarketDataService


_market_data = MarketDataService()

# A meaningful VaR estimate needs enough historical return observations
# to be more than noise. Below this, we report the calculation as
# unavailable instead of computing a percentile off a handful of points.
MIN_RETURN_OBSERVATIONS = 30


def calculate_var(
    ticker: str,
    position_value: float,
    confidence: float = 0.95,
    lookback_days: int = 120,
) -> dict:
    """Historical-simulation VaR from real returns only.

    Earlier versions of this function substituted a hardcoded array of
    made-up returns (``[-0.02, -0.01, 0.0, 0.012, 0.02]``) whenever live
    data wasn't available. That is exactly the kind of silent synthetic
    fallback the FINDEC v1 design explicitly rules out for production use
    -- a VaR computed from invented numbers is not "conservative", it is
    wrong in an undetectable way. This now returns ``dataAvailable: False``
    instead, and callers (risk_manager.py) must treat that as "risk could
    not be computed", not as a real (if approximate) risk number.
    """
    returns = _fetch_returns(ticker=ticker, lookback_days=lookback_days)

    if returns.size < MIN_RETURN_OBSERVATIONS:
        return {
            "dataAvailable": False,
            "var_pct": None,
            "var_usd": None,
            "confidence": round(confidence, 2),
            "volatility_pct": None,
            "observationCount": int(returns.size),
            "message": (
                f"Only {returns.size} historical return(s) available for {ticker.upper()} "
                f"(need >= {MIN_RETURN_OBSERVATIONS}); VaR was not computed rather than "
                "estimated from insufficient data."
            ),
        }

    percentile = max(0.1, min(99.9, (1 - confidence) * 100))
    var_pct = abs(float(np.percentile(returns, percentile) * 100))
    var_usd = position_value * (var_pct / 100)
    volatility_pct = float(np.std(returns) * 100)

    return {
        "dataAvailable": True,
        "var_pct": round(var_pct, 4),
        "var_usd": round(var_usd, 2),
        "confidence": round(confidence, 2),
        "volatility_pct": round(volatility_pct, 4),
        "observationCount": int(returns.size),
        "message": f"VaR computed from {int(returns.size)} historical daily returns.",
    }


def _fetch_returns(ticker: str, lookback_days: int) -> np.ndarray:
    try:
        history = _market_data.get_history(ticker=ticker, period="2y", interval="1d")
        if not history.available:
            return np.array([])
        closes = history.frame["Close"].astype(float).tail(lookback_days)
        return closes.pct_change().dropna().to_numpy()
    except Exception:
        return np.array([])
