"""
data_fetch.py

Shared, resilient historical price fetcher for FINDEC eval scripts.

Fetch order (stops at the first one that works):
  1. On-disk cache (.yf_cache/) - avoids re-hitting any API within TTL
  2. A manually-provided local CSV at ./data/<TICKER>.csv - since you
     already have real 1-year OHLCV data for all 5 tickers, this is
     checked FIRST so runs don't waste minutes retrying rate-limited
     APIs for data you already have on disk.
  3. yfinance - primary live source, but Yahoo rate-limits aggressively
     and the limiter can stay tripped for many minutes regardless of
     backoff
  4. Stooq CSV endpoint - free, no API key fallback. NOTE: Stooq has
     been intermittently blocking/breaking the `.us` suffix URL scheme
     for non-browser requests (returns 404). Kept as a last-resort
     source but don't rely on it.

Both eval_analyst.py and eval_recommendation.py import fetch_history()
from here instead of each defining their own, so a future fix only has
to happen in one place.

USAGE (manual local CSV, if you want to add/replace a ticker):
    1. Go to https://finance.yahoo.com/quote/AAPL/history
    2. Click "Download" to export historical data as CSV
    3. Save it as ./data/AAPL.csv (must have a Date column and a
       Close or Adj Close column -- see _try_local_csv for accepted
       header variants)
    4. Re-run your eval script - it will pick this up automatically
"""

from __future__ import annotations  # keep `list | None` hints working on Python < 3.10

import time
import pickle
from io import StringIO
from pathlib import Path

import numpy as np
import pandas as pd
import requests

CACHE_DIR = Path(__file__).parent / ".yf_cache"
CACHE_DIR.mkdir(exist_ok=True)
CACHE_TTL_SECONDS = 6 * 3600  # reuse a fetched ticker for 6 hours

LOCAL_DATA_DIR = Path(__file__).parent / "data"

# Accepted header spellings for the date and close-price columns, in
# priority order. Yahoo's manual CSV export, yfinance's own .to_csv(),
# and Stooq all spell these slightly differently.
DATE_COL_CANDIDATES = ["Date", "date", "Datetime", "datetime"]
CLOSE_COL_CANDIDATES = [
    "Close", "close", "Adj Close", "adj close", "Adj_Close", "AdjClose",
    "Close/Last", "close/last",  # Nasdaq.com export format
]
VOLUME_COL_CANDIDATES = ["Volume", "volume", "Vol", "vol", "Vol."]


def _cache_path(ticker: str, period: str) -> Path:
    return CACHE_DIR / f"{ticker.upper()}_{period}.pkl"


def _from_cache(ticker: str, period: str):
    cache_file = _cache_path(ticker, period)
    if cache_file.exists() and (time.time() - cache_file.stat().st_mtime) < CACHE_TTL_SECONDS:
        with open(cache_file, "rb") as f:
            return pickle.load(f)
    return None


def _save_cache(ticker: str, period: str, df: pd.DataFrame) -> None:
    with open(_cache_path(ticker, period), "wb") as f:
        pickle.dump(df, f)


def _period_to_days(period: str) -> int:
    unit = period[-1]
    try:
        n = int(period[:-1])
    except ValueError:
        return 365 * 3
    return {"d": n, "mo": n * 30, "y": n * 365}.get(unit, 365 * 3)


def _find_col(df: pd.DataFrame, candidates: list) -> str | None:
    """Case/spelling-tolerant column lookup."""
    lower_map = {str(c).strip().lower(): c for c in df.columns}
    for cand in candidates:
        hit = lower_map.get(cand.strip().lower())
        if hit is not None:
            return hit
    return None


def _try_local_csv(ticker: str):
    """
    Checked FIRST. A CSV placed at ./data/<TICKER>.csv (case-insensitive
    on most filesystems). Tolerates Yahoo's manual-export headers,
    yfinance's own export headers, and a stray leading index column.
    """
    path = LOCAL_DATA_DIR / f"{ticker.upper()}.csv"
    if not path.exists():
        # Try a case-insensitive scan in case the file was saved lowercase
        # or with a different extension casing.
        if LOCAL_DATA_DIR.exists():
            for f in LOCAL_DATA_DIR.iterdir():
                if f.is_file() and f.stem.upper() == ticker.upper() and f.suffix.lower() == ".csv":
                    path = f
                    break
        if not path.exists():
            return None

    try:
        df = pd.read_csv(path)
    except Exception as e:
        print(f"  [local_csv:{ticker}] failed to read {path}: {e}")
        return None

    # yfinance's raw .to_csv() sometimes writes a 2-row multi-index header
    # ("Price,Close,High,..." / "Ticker,AAPL,AAPL,...") -- detect and skip it.
    if df.columns[0] in ("Price", "Ticker") or str(df.iloc[0, 0]).strip().lower() == "ticker":
        try:
            df = pd.read_csv(path, skiprows=[1, 2])
        except Exception:
            pass

    date_col = _find_col(df, DATE_COL_CANDIDATES)
    close_col = _find_col(df, CLOSE_COL_CANDIDATES)
    volume_col = _find_col(df, VOLUME_COL_CANDIDATES)

    if date_col is None or close_col is None:
        print(f"  [local_csv:{ticker}] {path.name} missing expected columns "
              f"(found: {list(df.columns)}; need a Date-like and Close-like column)")
        return None

    keep_cols = {date_col: "Date", close_col: "Close"}
    if volume_col is not None:
        keep_cols[volume_col] = "Volume"
    out = df[list(keep_cols.keys())].rename(columns=keep_cols)
    out["Date"] = pd.to_datetime(out["Date"], errors="coerce")
    # Nasdaq.com exports prices/volumes as "$123.45" / "1,234,567" strings.
    # NOTE: don't gate this on `dtype == object` -- pandas 3.x gives string
    # columns a native "str" dtype instead of "object", so that check
    # silently no-ops there and every row gets dropped downstream. Checking
    # is_numeric_dtype works across pandas 1.x/2.x/3.x.
    for col in ["Close", "Volume"]:
        if col in out.columns and not pd.api.types.is_numeric_dtype(out[col]):
            out[col] = out[col].astype(str).str.replace(r"[\$,]", "", regex=True).str.strip()
    out["Close"] = pd.to_numeric(out["Close"], errors="coerce")
    if "Volume" in out.columns:
        out["Volume"] = pd.to_numeric(out["Volume"], errors="coerce")
    else:
        out["Volume"] = np.nan
    out = out.dropna(subset=["Date", "Close"]).sort_values("Date").reset_index(drop=True)

    if out.empty:
        print(f"  [local_csv:{ticker}] {path.name} had no usable rows after cleaning")
        return None

    return out


def _try_yfinance(ticker: str, period: str, max_retries: int = 3, base_delay: float = 20.0):
    try:
        import yfinance as yf
    except ImportError:
        return None

    for attempt in range(max_retries):
        try:
            frame = yf.download(tickers=ticker, period=period, interval="1d",
                                 auto_adjust=True, progress=False, threads=False)
            if frame is None or frame.empty or "Close" not in frame.columns:
                raise RuntimeError("empty/invalid response (likely rate-limited)")

            normalized = frame.reset_index().copy()
            date_col = next((c for c in normalized.columns if str(c).lower() in {"date", "datetime"}), None)
            normalized["Date"] = pd.to_datetime(normalized[date_col] if date_col else normalized.index)
            normalized["Close"] = normalized["Close"].astype(float)
            if "Volume" in normalized.columns:
                normalized["Volume"] = pd.to_numeric(normalized["Volume"], errors="coerce")
            else:
                normalized["Volume"] = np.nan
            result = normalized[["Date", "Close", "Volume"]].dropna(subset=["Close"]).reset_index(drop=True)
            if result.empty:
                raise RuntimeError("no usable rows after cleaning")
            return result

        except Exception as e:
            if attempt < max_retries - 1:
                wait = base_delay * (2 ** attempt)
                print(f"  [yfinance:{ticker}] attempt {attempt + 1}/{max_retries} failed "
                      f"({e}); waiting {wait:.0f}s...")
                time.sleep(wait)
    return None


def _try_stooq(ticker: str, period: str):
    """
    Stooq: free, no API key. NOTE -- as of mid-2026 Stooq has been
    intermittently returning 404s for the `.us` suffix scheme on
    non-browser requests. Kept as a last-resort source only.
    """
    symbol = ticker.lower()
    if "." not in symbol:
        symbol = f"{symbol}.us"
    url = f"https://stooq.com/q/d/l/?s={symbol}&i=d"

    try:
        resp = requests.get(
            url, timeout=15,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
        )
        resp.raise_for_status()
        df = pd.read_csv(StringIO(resp.text))
        if df.empty or "Close" not in df.columns or "Date" not in df.columns:
            return None

        df["Date"] = pd.to_datetime(df["Date"])
        df["Close"] = df["Close"].astype(float)
        if "Volume" in df.columns:
            df["Volume"] = pd.to_numeric(df["Volume"], errors="coerce")
        else:
            df["Volume"] = np.nan
        df = df[["Date", "Close", "Volume"]].dropna(subset=["Close"]).reset_index(drop=True)

        cutoff = pd.Timestamp.today() - pd.Timedelta(days=_period_to_days(period))
        df = df[df["Date"] >= cutoff].reset_index(drop=True)
        return df if not df.empty else None

    except Exception as e:
        print(f"  [stooq:{ticker}] fallback failed: {e}")
        return None


def fetch_history(ticker: str, period: str = "3y") -> pd.DataFrame:
    """
    Returns a DataFrame with columns [Date, Close] for `ticker` over
    `period`. Tries, in order: local cache -> local CSV (your real
    1-year data) -> yfinance -> Stooq. Raises RuntimeError only if ALL
    sources fail.
    """
    cached = _from_cache(ticker, period)
    if cached is not None:
        return cached

    result = _try_local_csv(ticker)
    source = "local_csv"

    if result is None:
        print(f"  [{ticker}] no usable local CSV, trying yfinance...")
        result = _try_yfinance(ticker, period)
        source = "yfinance"

    if result is None:
        print(f"  [{ticker}] yfinance exhausted, falling back to Stooq...")
        result = _try_stooq(ticker, period)
        source = "stooq"

    if result is None:
        raise RuntimeError(
            f"Could not fetch {ticker} from a local CSV, yfinance, or Stooq.\n"
            f"Manual fix: go to https://finance.yahoo.com/quote/{ticker}/history, "
            f"click Download, and save the CSV as "
            f"{LOCAL_DATA_DIR / (ticker.upper() + '.csv')}"
        )

    print(f"  [{ticker}] fetched via {source} ({len(result)} rows)")
    _save_cache(ticker, period, result)
    return result