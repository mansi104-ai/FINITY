import time

try:
    from ..models.market_data import MarketDataService
    from ..models.market_forecaster import MarketForecaster
except Exception:
    try:
        from models.market_data import MarketDataService
        from models.market_forecaster import MarketForecaster
    except ModuleNotFoundError:
        from python_agents.models.market_data import MarketDataService
        from python_agents.models.market_forecaster import MarketForecaster


class AnalystAgent:
    def __init__(self) -> None:
        self.data_service = MarketDataService()
        self.forecaster = MarketForecaster()

    def predict(self, ticker: str, query: str, sentiment: dict | None = None) -> dict:
        start = time.perf_counter()
        sentiment = sentiment or {}
        market_history = self.data_service.get_history(ticker=ticker, period="3y", interval="1d")
        result = self.forecaster.predict(
            market_history.frame,
            ticker=ticker,
            query=query,
            sentiment_score=float(sentiment.get("score", 0.5)),
            sentiment_level=str(sentiment.get("level", "HOLD")),
            data_source=market_history.source,
        )
        result["durationMs"] = int((time.perf_counter() - start) * 1000)
        result["message"] = (
            f"Generated {result.get('horizonLabel', 'forward')} forecast from {market_history.source} history"
        )
        return result
