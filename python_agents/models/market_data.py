from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Dict, Tuple

import numpy as np
import pandas as pd

try:
    import yfinance as yf  # type: ignore
except Exception:  # pragma: no cover
    yf = None


@dataclass
class MarketHistory:
    frame: pd.DataFrame
    source: str


class MarketDataService:
    def __init__(self, cache_ttl_seconds: int = 900) -> None:
        self.cache_ttl_seconds = cache_ttl_seconds
        self._cache: Dict[Tuple[str, str, str], Tuple[float, MarketHistory]] = {}

    def get_history(self, ticker: str, period: str = "3y", interval: str = "1d") -> MarketHistory:
        cache_key = (ticker.upper(), period, interval)
        now = time.time()
        cached = self._cache.get(cache_key)
        if cached and now - cached[0] < self.cache_ttl_seconds:
            return cached[1]

        history = self._fetch_live_history(ticker=ticker, period=period, interval=interval)
        if history is None:
            history = MarketHistory(frame=self._synthetic_history(seed=ticker), source="synthetic")

        self._cache[cache_key] = (now, history)
        return history

    def _fetch_live_history(self, ticker: str, period: str, interval: str) -> MarketHistory | None:
        if yf is None:
            return None

        try:
            frame = yf.Ticker(ticker).history(period=period, interval=interval, auto_adjust=True)
            if frame.empty or "Close" not in frame:
                return None

            normalized = frame.reset_index().copy()
            date_column = next((column for column in normalized.columns if str(column).lower() in {"date", "datetime"}), None)
            if date_column is None:
                normalized["Date"] = pd.date_range(end=pd.Timestamp.utcnow().normalize(), periods=len(normalized), freq="B")
            else:
                normalized["Date"] = pd.to_datetime(normalized[date_column], errors="coerce")
            normalized["Close"] = normalized["Close"].astype(float)
            normalized = normalized[["Date", "Close"]].dropna(subset=["Close"]).reset_index(drop=True)
            if len(normalized) < 80:
                return None
            return MarketHistory(frame=normalized, source="yfinance")
        except Exception:
            return None

    def _synthetic_history(self, seed: str) -> pd.DataFrame:
        seed_value = abs(hash(seed)) % (2**32)
        rng = np.random.default_rng(seed_value)
        base = 100 + (seed_value % 120)
        noise = rng.normal(0, 1.8, size=720)
        drift = rng.normal(0.05, 0.04, size=720)

        prices = [float(base)]
        for idx in range(1, 720):
            move = (drift[idx] + noise[idx] * 0.17) / 100
            prices.append(max(5.0, prices[-1] * (1 + move)))

        dates = pd.bdate_range(end=pd.Timestamp.utcnow().normalize(), periods=len(prices))
        return pd.DataFrame({"Date": dates, "Close": prices})
