"""Market Agent (FINDEC v1).

"Only data. No reasoning." Fetches OHLCV history and returns a structured
snapshot of price/volume features (moving averages, RSI, volatility,
volume ratio). It does not predict, does not score, does not recommend --
that is the Prediction Engine (analyst.py) and Risk Reasoning's job.

Reuses the existing MarketDataService (yfinance -> Stooq -> stale cache ->
explicit "unavailable", never fabricated data) rather than duplicating
fetch/cache logic.
"""

import time

import numpy as np
import pandas as pd

RSI_PERIOD = 14
MA_SHORT = 5
MA_LONG = 20
VOL_WINDOW = 20
VOLUME_WINDOW = 20

try:
    from ..models.market_data import MarketDataService
except Exception:
    try:
        from models.market_data import MarketDataService
    except ModuleNotFoundError:
        from python_agents.models.market_data import MarketDataService


class MarketAgent:
    """Data-only agent: downloads prices, computes indicators, returns features."""

    def __init__(self) -> None:
        self.data_service = MarketDataService()

    def fetch(self, ticker: str) -> dict:
        start = time.perf_counter()
        history = self.data_service.get_history(ticker=ticker, period="3y", interval="1d")
        frame = history.frame

        if not history.available or frame.empty:
            return {
                "ticker": ticker.upper(),
                "dataSource": history.source,
                "dataAvailable": False,
                "lastClose": None,
                "movingAverageShort": None,
                "movingAverageLong": None,
                "rsi": None,
                "volatilityPct": None,
                "volumeRatio": None,
                "trend": None,
                "observationCount": 0,
                "message": (
                    f"No live or cached market data available for {ticker.upper()}."
                    if not history.available
                    else f"Market data for {ticker.upper()} was empty."
                ),
                "warnings": history.warnings,
                "durationMs": int((time.perf_counter() - start) * 1000),
            }

        closes = frame["Close"].astype(float)
        volumes = frame["Volume"].astype(float) if "Volume" in frame else pd.Series(dtype=float)

        last_close = float(closes.iloc[-1])
        ma_short = float(closes.tail(MA_SHORT).mean())
        ma_long = float(closes.tail(MA_LONG).mean())
        rsi = self._rsi(closes, period=RSI_PERIOD)
        volatility_pct = float(closes.pct_change().tail(VOL_WINDOW).std() * 100) if len(closes) > VOL_WINDOW else None
        volume_ratio = self._volume_ratio(volumes)
        trend = "uptrend" if ma_short > ma_long else "downtrend" if ma_short < ma_long else "flat"

        return {
            "ticker": ticker.upper(),
            "dataSource": history.source,
            "dataAvailable": True,
            "asOf": history.asOf,
            "lastClose": round(last_close, 2),
            "movingAverageShort": round(ma_short, 2),
            "movingAverageLong": round(ma_long, 2),
            "rsi": round(rsi, 2) if rsi is not None else None,
            "volatilityPct": round(volatility_pct, 3) if volatility_pct is not None else None,
            "volumeRatio": round(volume_ratio, 3) if volume_ratio is not None else None,
            "trend": trend,
            "observationCount": int(len(closes)),
            "message": f"Fetched {len(closes)} sessions of {ticker.upper()} data from {history.source}.",
            "warnings": history.warnings,
            "durationMs": int((time.perf_counter() - start) * 1000),
        }

    def _rsi(self, closes: pd.Series, period: int) -> float | None:
        if len(closes) <= period:
            return None
        delta = closes.diff().dropna()
        gains = delta.clip(lower=0)
        losses = -delta.clip(upper=0)
        avg_gain = gains.tail(period).mean()
        avg_loss = losses.tail(period).mean()
        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return float(100 - (100 / (1 + rs)))

    def _volume_ratio(self, volumes: pd.Series) -> float | None:
        clean = volumes.dropna()
        if len(clean) <= VOLUME_WINDOW:
            return None
        latest = float(clean.iloc[-1])
        baseline = float(clean.tail(VOLUME_WINDOW).mean())
        if baseline == 0:
            return None
        return latest / baseline