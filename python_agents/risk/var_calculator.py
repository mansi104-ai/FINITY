import numpy as np

try:
    from ..models.market_data import MarketDataService
except Exception:
    try:
        from models.market_data import MarketDataService
    except ModuleNotFoundError:
        from python_agents.models.market_data import MarketDataService


_market_data = MarketDataService()


def calculate_var(
    ticker: str,
    position_value: float,
    confidence: float = 0.95,
    lookback_days: int = 120,
) -> dict:
    returns = _fetch_returns(ticker=ticker, lookback_days=lookback_days)

    if returns.size == 0:
        returns = np.array([-0.02, -0.01, 0.0, 0.012, 0.02])

    percentile = max(0.1, min(99.9, (1 - confidence) * 100))
    var_pct = abs(float(np.percentile(returns, percentile) * 100))
    var_usd = position_value * (var_pct / 100)
    volatility_pct = float(np.std(returns) * 100)

    return {
        "var_pct": round(var_pct, 4),
        "var_usd": round(var_usd, 2),
        "confidence": round(confidence, 2),
        "volatility_pct": round(volatility_pct, 4),
    }


def _fetch_returns(ticker: str, lookback_days: int) -> np.ndarray:
    try:
        history = _market_data.get_history(ticker=ticker, period="2y", interval="1d")
        closes = history.frame["Close"].astype(float).tail(lookback_days)
        return closes.pct_change().dropna().to_numpy()
    except Exception:
        return np.array([])
