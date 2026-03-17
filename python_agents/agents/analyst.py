import os
import time
from datetime import datetime, timezone

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
        history, market_meta = self._fetch_prices(ticker)
        result = self.model.predict(history)
        result["ticker"] = ticker
        result["priceSource"] = market_meta["priceSource"]
        result["previousClose"] = market_meta.get("previousClose")
        result["livePrice"] = market_meta.get("livePrice")
        result["priceAsOf"] = market_meta.get("priceAsOf")
        result["marketState"] = market_meta.get("marketState", "unknown")

        if market_meta.get("livePrice") is not None:
            live_price = float(market_meta["livePrice"])
            predicted_return = float(result.get("predictedReturnPct", 0.0))
            result["currentPrice"] = round(live_price, 2)
            result["predictedPrice"] = round(live_price * (1 + predicted_return / 100), 2)

        result["durationMs"] = int((time.perf_counter() - start) * 1000)
        result["message"] = "Generated 5-day forecast"
        return result

    def _fetch_prices(self, ticker: str):
        if yf is None or not self.use_live_data:
            synthetic = self.model.synthetic_history(seed=ticker)
            last_close = float(synthetic["Close"].iloc[-1])
            return (
                synthetic,
                {
                    "priceSource": "synthetic",
                    "previousClose": round(float(synthetic["Close"].iloc[-2]), 2),
                    "livePrice": round(last_close, 2),
                    "priceAsOf": self._iso_now(),
                    "marketState": "unknown",
                },
            )

        try:
            ticker_obj = yf.Ticker(ticker)
            frame = ticker_obj.history(period="6mo", interval="1d")
            if frame.empty or "Close" not in frame:
                raise ValueError("No market data")

            intraday = ticker_obj.history(period="1d", interval="5m")
            fast_info = getattr(ticker_obj, "fast_info", {}) or {}

            previous_close = self._safe_float(fast_info.get("previousClose"))
            if previous_close is None and len(frame.index) >= 2:
                previous_close = float(frame["Close"].iloc[-2])

            live_price = self._safe_float(fast_info.get("lastPrice"))
            if live_price is None and not intraday.empty and "Close" in intraday:
                live_price = float(intraday["Close"].dropna().iloc[-1])
            if live_price is None:
                live_price = float(frame["Close"].iloc[-1])

            price_as_of = self._iso_now()
            if not intraday.empty:
                try:
                    price_as_of = intraday.index[-1].to_pydatetime().astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
                except Exception:
                    price_as_of = self._iso_now()

            market_state = "open" if not intraday.empty else "closed"

            return (
                frame,
                {
                    "priceSource": "live",
                    "previousClose": round(previous_close, 2) if previous_close is not None else None,
                    "livePrice": round(live_price, 2),
                    "priceAsOf": price_as_of,
                    "marketState": market_state,
                },
            )
        except Exception:
            synthetic = self.model.synthetic_history(seed=ticker)
            last_close = float(synthetic["Close"].iloc[-1])
            return (
                synthetic,
                {
                    "priceSource": "synthetic",
                    "previousClose": round(float(synthetic["Close"].iloc[-2]), 2),
                    "livePrice": round(last_close, 2),
                    "priceAsOf": self._iso_now(),
                    "marketState": "unknown",
                },
            )

    def _safe_float(self, value):
        try:
            if value is None:
                return None
            return float(value)
        except Exception:
            return None

    def _iso_now(self) -> str:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
