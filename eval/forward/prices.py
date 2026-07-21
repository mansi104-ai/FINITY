"""Daily price source for the forward test.

Yahoo's ``v8/finance/chart`` endpoint. Chosen after measuring the
alternatives on 2026-07-21: Stooq returned HTML for every symbol tried,
the project's Finnhub key returns 401, and ``yfinance`` is not installed.
v8 returned complete series for 8/8 symbols. Yahoo's ``v7/finance/quote`` is
IP-blocked from cloud hosts while v8 is not, so v8 is also the endpoint most
likely to keep working from a scheduled runner.

Two traps this module exists to avoid:

**``chartPreviousClose`` is not yesterday's close.** It is the close
immediately before the *requested range*, so on a 6-month request it is six
months old (AAPL: 246.70 against a 326.59 current price). Previous close is
taken from the series.

**A forward test must record what it saw, when it saw it.** Every fetch is
written to a dated cache keyed by fetch date, so a decision made on day t can
be re-derived from exactly the bars available on day t. Re-running later and
silently picking up revised or backfilled data would reintroduce, by the back
door, the contamination the forward test exists to eliminate.
"""

from __future__ import annotations

import json
import random
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
_UA = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122 Safari/537.36"
    )
}

DEFAULT_CACHE = Path(__file__).resolve().parents[2] / "eval" / "forward" / "_pricecache"


@dataclass
class Bars:
    """Daily OHLCV for one symbol, oldest first."""

    symbol: str
    dates: List[str] = field(default_factory=list)     # ISO yyyy-mm-dd, UTC
    close: List[float] = field(default_factory=list)
    high: List[float] = field(default_factory=list)
    low: List[float] = field(default_factory=list)
    volume: List[float] = field(default_factory=list)
    currency: str = ""
    exchange_tz: str = ""
    fetched_at: str = ""
    source: str = "yahoo-v8"

    def __len__(self) -> int:
        return len(self.close)

    @property
    def last_date(self) -> Optional[str]:
        return self.dates[-1] if self.dates else None

    @property
    def last_close(self) -> Optional[float]:
        return self.close[-1] if self.close else None

    def close_on(self, day: str) -> Optional[float]:
        try:
            return self.close[self.dates.index(day)]
        except ValueError:
            return None

    def index_of(self, day: str) -> Optional[int]:
        try:
            return self.dates.index(day)
        except ValueError:
            return None

    def to_dict(self) -> Dict:
        return {
            "symbol": self.symbol, "dates": self.dates, "close": self.close,
            "high": self.high, "low": self.low, "volume": self.volume,
            "currency": self.currency, "exchange_tz": self.exchange_tz,
            "fetched_at": self.fetched_at, "source": self.source,
        }

    @staticmethod
    def from_dict(d: Dict) -> "Bars":
        return Bars(**d)


class PriceFetcher:
    def __init__(self, cache_dir: Path = DEFAULT_CACHE,
                 pause: float = 0.35, retries: int = 3) -> None:
        self.cache_dir = Path(cache_dir)
        self.pause = pause
        self.retries = retries
        self.errors: Dict[str, str] = {}

    # ------------------------------------------------------------------
    def _cache_path(self, symbol: str, on: str) -> Path:
        return self.cache_dir / on / f"{symbol.replace('/', '_')}.json"

    def get(self, symbol: str, rng: str = "2y",
            fetch_date: Optional[str] = None,
            use_cache: bool = True) -> Optional[Bars]:
        """Daily bars for ``symbol``, oldest first. None on failure.

        Cached per fetch date. A second call on the same day is served from
        disk, which keeps a re-run of the daily job cheap and, more
        importantly, identical.
        """
        on = fetch_date or date.today().isoformat()
        cp = self._cache_path(symbol, on)

        if use_cache and cp.exists():
            try:
                return Bars.from_dict(json.loads(cp.read_text(encoding="utf-8")))
            except Exception:
                pass  # corrupt cache entry: refetch

        bars = self._fetch(symbol, rng)
        if bars is None:
            return None
        try:
            cp.parent.mkdir(parents=True, exist_ok=True)
            cp.write_text(json.dumps(bars.to_dict()), encoding="utf-8")
        except Exception:
            pass
        return bars

    # ------------------------------------------------------------------
    def _fetch(self, symbol: str, rng: str) -> Optional[Bars]:
        url = CHART_URL.format(sym=symbol) + f"?range={rng}&interval=1d"
        last_err = ""
        for attempt in range(self.retries):
            try:
                req = urllib.request.Request(url, headers=_UA)
                with urllib.request.urlopen(req, timeout=30) as r:
                    payload = json.load(r)
                break
            except urllib.error.HTTPError as e:
                last_err = f"HTTP {e.code}"
                # 429/5xx are transient; anything else will not improve.
                if e.code not in (429, 500, 502, 503, 504):
                    self.errors[symbol] = last_err
                    return None
            except Exception as e:
                last_err = f"{type(e).__name__}: {e}"
            time.sleep((2 ** attempt) + random.random())
        else:
            self.errors[symbol] = last_err or "exhausted retries"
            return None

        try:
            res = payload["chart"]["result"][0]
            meta = res.get("meta") or {}
            stamps = res.get("timestamp") or []
            q = (res.get("indicators") or {}).get("quote") or [{}]
            q = q[0] if q else {}
            closes = q.get("close") or []
        except Exception as e:
            self.errors[symbol] = f"unexpected payload shape: {e}"
            return None

        bars = Bars(symbol=symbol, currency=meta.get("currency", ""),
                    exchange_tz=meta.get("exchangeTimezoneName", ""),
                    fetched_at=datetime.now(timezone.utc).isoformat())

        for i, ts in enumerate(stamps):
            c = closes[i] if i < len(closes) else None
            if c is None:
                continue  # holiday/halt padding -- drop rather than forward-fill
            bars.dates.append(datetime.fromtimestamp(ts, timezone.utc).date().isoformat())
            bars.close.append(float(c))
            for src, dst in (("high", bars.high), ("low", bars.low), ("volume", bars.volume)):
                v = (q.get(src) or [None] * len(stamps))
                v = v[i] if i < len(v) else None
                dst.append(float(v) if v is not None else float("nan"))

        if not bars.close:
            self.errors[symbol] = "no usable closes"
            return None
        time.sleep(self.pause)
        return bars

    # ------------------------------------------------------------------
    def get_many(self, symbols: List[str], rng: str = "2y",
                 fetch_date: Optional[str] = None) -> Dict[str, Bars]:
        out: Dict[str, Bars] = {}
        for s in symbols:
            b = self.get(s, rng=rng, fetch_date=fetch_date)
            if b is not None:
                out[s] = b
        return out
