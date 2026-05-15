import time

HISTORY_DAYS = 90
TRAIN_WINDOW = 60
BUY_THRESHOLD = 0.005
SELL_THRESHOLD = -0.005
RSI_PERIOD = 14
MA_SHORT = 5
MA_LONG = 20
VOL_WINDOW = 20
GBM_MU = 0.0003
GBM_SIGMA = 0.015

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
        result.setdefault("methodFactors", []).extend(
            [
                f"Analyst constants: history_days={HISTORY_DAYS}, train_window={TRAIN_WINDOW}, RSI={RSI_PERIOD}, MA={MA_SHORT}/{MA_LONG}, vol_window={VOL_WINDOW}.",
                f"Decision thresholds: buy if predicted return >= {BUY_THRESHOLD:.3f}, sell if <= {SELL_THRESHOLD:.3f}.",
                f"GBM fallback params: mu={GBM_MU}, sigma={GBM_SIGMA}.",
            ]
        )
        return result
