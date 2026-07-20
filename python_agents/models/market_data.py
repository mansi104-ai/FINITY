from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from io import StringIO
from typing import Dict, Optional, Tuple

import numpy as np
import pandas as pd
import requests
from cachetools import TTLCache

try:
    import yfinance as yf  # type: ignore
except Exception:  # pragma: no cover
    yf = None


OHLCV_CACHE_TTL_SECONDS = 300
ohlcv_cache = TTLCache(maxsize=50, ttl=OHLCV_CACHE_TTL_SECONDS)

# How long a "stale" cached frame is still allowed to be served as a last
# resort when every live provider fails. This is NOT fabricated data -- it
# is real, previously-fetched OHLCV, just older than the normal cache TTL.
STALE_CACHE_MAX_AGE_SECONDS = 24 * 3600

MIN_USABLE_SESSIONS = 80


@dataclass
class MarketHistory:
    frame: pd.DataFrame
    source: str
    # False only when no live provider and no usable stale cache were
    # available. Downstream agents must degrade gracefully (skip
    # prediction/risk sizing, surface a clear message) instead of
    # inventing numbers when this is False.
    available: bool = True
    asOf: Optional[str] = None
    warnings: list = field(default_factory=list)


class MarketDataService:
    """Fetches real OHLCV history with an explicit multi-provider fallback
    chain and NO synthetic/fabricated data:

        yfinance (Yahoo Finance) -> Stooq (no API key required)
            -> stale in-process cache (< 24h old, clearly labeled)
            -> explicit "unavailable" result

    Callers must check `MarketHistory.available` and degrade the
    recommendation (e.g. skip prediction, force HOLD) rather than treat an
    unavailable result as if it were real data.
    """

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
            history = self._fetch_stooq_history(ticker=ticker)

        if history is None and cached is not None:
            stale_age = now - cached[0]
            if stale_age < STALE_CACHE_MAX_AGE_SECONDS:
                stale = cached[1]
                history = MarketHistory(
                    frame=stale.frame,
                    source=f"{stale.source}-stale-cache",
                    available=True,
                    asOf=stale.asOf,
                    warnings=stale.warnings + [
                        f"Live providers unavailable; served cached data ~{int(stale_age / 60)} min old."
                    ],
                )

        if history is None:
            history = MarketHistory(
                frame=pd.DataFrame(columns=["Date", "Close", "Volume"]),
                source="unavailable",
                available=False,
                asOf=self._iso_now(),
                warnings=[
                    f"No live or cached market data available for {ticker.upper()} "
                    "(Yahoo Finance and Stooq both failed)."
                ],
            )
            # Don't cache a failure -- let the next request retry the
            # providers instead of being stuck on "unavailable" for
            # cache_ttl_seconds.
            return history

        self._cache[cache_key] = (now, history)
        return history

    def _fetch_live_history(self, ticker: str, period: str, interval: str) -> MarketHistory | None:
        if yf is None:
            return None

        cache_key = (ticker.upper(), period, interval)
        cached_frame = ohlcv_cache.get(cache_key)
        if cached_frame is not None:
            return MarketHistory(frame=cached_frame.copy(), source="yfinance")

        try:
            frame = yf.download(
                tickers=ticker,
                period=period,
                interval=interval,
                auto_adjust=True,
                progress=False,
                threads=False,
            )
            if frame.empty or "Close" not in frame:
                return None

            normalized = frame.reset_index().copy()
            date_column = next((column for column in normalized.columns if str(column).lower() in {"date", "datetime"}), None)
            if date_column is None:
                normalized["Date"] = pd.date_range(end=pd.Timestamp.utcnow().normalize(), periods=len(normalized), freq="B")
            else:
                normalized["Date"] = pd.to_datetime(normalized[date_column], errors="coerce")
            normalized["Close"] = normalized["Close"].astype(float)
            if "Volume" in normalized.columns:
                normalized["Volume"] = pd.to_numeric(normalized["Volume"], errors="coerce")
            else:
                normalized["Volume"] = np.nan
            normalized = normalized[["Date", "Close", "Volume"]].dropna(subset=["Close"]).reset_index(drop=True)
            if len(normalized) < MIN_USABLE_SESSIONS:
                return None
            ohlcv_cache[cache_key] = normalized.copy()
            return MarketHistory(frame=normalized, source="yfinance", available=True, asOf=self._iso_now())
        except Exception:
            return None

    def _fetch_stooq_history(self, ticker: str) -> Optional[MarketHistory]:
        """Stooq's CSV endpoint requires no API key and no signup. Used as
        the second real-data provider when Yahoo Finance is unreachable or
        rate-limited. US tickers need a `.us` suffix on Stooq."""
        symbol = ticker.strip().lower()
        candidates = [symbol] if "." in symbol else [f"{symbol}.us", symbol]
        for candidate in candidates:
            try:
                response = requests.get(
                    "https://stooq.com/q/d/l/",
                    params={"s": candidate, "i": "d"},
                    timeout=6,
                )
                response.raise_for_status()
                text = response.text
                if not text or text.strip().lower().startswith("no data") or "Date,Open,High,Low,Close,Volume" not in text:
                    continue
                frame = pd.read_csv(StringIO(text))
                if frame.empty or "Close" not in frame or "Date" not in frame:
                    continue
                frame["Date"] = pd.to_datetime(frame["Date"], errors="coerce")
                frame["Close"] = pd.to_numeric(frame["Close"], errors="coerce")
                frame["Volume"] = pd.to_numeric(frame.get("Volume"), errors="coerce")
                frame = frame[["Date", "Close", "Volume"]].dropna(subset=["Close"]).reset_index(drop=True)
                if len(frame) < MIN_USABLE_SESSIONS:
                    continue
                return MarketHistory(frame=frame, source="stooq", available=True, asOf=self._iso_now())
            except Exception:
                continue
        return None

    def _iso_now(self) -> str:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")