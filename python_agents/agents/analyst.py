import os
import time

try:
    import yfinance as yf  # type: ignore
except Exception:  # pragma: no cover
    yf = None

try:
    from models.lstm_model import LSTMModel
except ModuleNotFoundError:
    from python_agents.models.lstm_model import LSTMModel


class AnalystAgent:
    def __init__(self) -> None:
        self.model = LSTMModel(window=12)
        self.use_live_data = os.getenv("USE_LIVE_MARKET_DATA", "false").lower() == "true"

    def predict(self, ticker: str) -> dict:
        start = time.perf_counter()
        history = self._fetch_prices(ticker)
        result = self.model.predict(history)
        result["ticker"] = ticker
        result["durationMs"] = int((time.perf_counter() - start) * 1000)
        result["message"] = "Generated 5-day forecast"
        return result

    def _fetch_prices(self, ticker: str):
        if yf is None or not self.use_live_data:
            return self.model.synthetic_history(seed=ticker)

        try:
            frame = yf.Ticker(ticker).history(period="6mo")
            if frame.empty or "Close" not in frame:
                raise ValueError("No market data")
            return frame
        except Exception:
            return self.model.synthetic_history(seed=ticker)
