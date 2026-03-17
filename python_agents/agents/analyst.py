import yfinance as yf
from models.lstm_model import LSTMModel

class AnalystAgent:
    def __init__(self):
        self.model = LSTMModel()

    def predict(self, ticker: str) -> dict:
        df = self._fetch_prices(ticker)
        result = self.model.predict(df)

        return {
            "direction":    result["direction"],   # "up" | "down"
            "change_pct":   result["change_pct"],  # e.g. 2.1
            "confidence":   result["confidence"],  # 0–1
            "current_price": df["Close"].iloc[-1]
        }

    def _fetch_prices(self, ticker: str):
        stock = yf.Ticker(ticker)
        return stock.history(period="60d")