"""Adapters binding decision-plane agents to the Router's contract.

Each adapter takes a ``SubTask`` and a point-in-time cutoff and returns an
``AgentResult``. Three rules hold across all of them, and they are what make
the results usable as evidence rather than decoration:

**Never fabricate.** A source that cannot be reached returns
``UNAVAILABLE``; a source reached with nothing to say returns ``NO_DATA``.
The two are different information and are kept apart. Neither is replaced by
a neutral-looking number, because downstream nothing could tell such a number
apart from a real reading.

**Confidence is earned, not asserted.** Each adapter derives ``confidence``
from something measurable -- sample size, agreement between indicators,
dispersion of sentiment -- rather than from a model's opinion of itself.
Calibration is then checked against outcomes by the reliability layer.

**Respect the cutoff.** Every adapter filters its inputs to ``as_of`` and
records what it actually saw. The Router re-checks and rejects any result
claiming data newer than the cutoff.
"""

from __future__ import annotations

import json
import math
import os
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional

try:
    from ..contracts import AgentName, AgentResult, Evidence, ResultStatus, SubTask
except ImportError:
    from contracts import AgentName, AgentResult, Evidence, ResultStatus, SubTask  # type: ignore

_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122 Safari/537.36"}


def _env(name: str) -> str:
    v = os.getenv(name, "").strip()
    if v:
        return v
    for p in (Path.cwd() / ".env.local",
              Path(__file__).resolve().parents[2] / ".env.local"):
        try:
            for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
                if line.startswith(f"{name}="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
        except Exception:
            continue
    return ""


def _ticker_of(st: SubTask) -> Optional[str]:
    t = st.params.get("ticker")
    if t:
        return str(t).upper()
    # Fall back to a symbol-shaped token in the question. The Planner is
    # instructed to restate the ticker in every subtask, so this is a
    # backstop, not the primary path.
    import re
    for tok in re.findall(r"\b([A-Z]{1,5}(?:-[A-Z])?)\b", st.question):
        if tok not in {"VAR", "US", "AI", "CEO", "ETF", "P", "E", "A", "I"}:
            return tok
    return None


# --------------------------------------------------------------------------
# Market
# --------------------------------------------------------------------------

def make_market_adapter(fetcher) -> "callable":
    """Price action, realised volatility and trend from daily bars."""

    def adapter(st: SubTask, as_of: Optional[str]) -> AgentResult:
        t0 = time.perf_counter()
        sym = _ticker_of(st)
        if not sym:
            return AgentResult(subtask_id=st.id, agent=AgentName.MARKET,
                               status=ResultStatus.NO_DATA, confidence=0.0,
                               reasoning=["no ticker in subtask"])
        bars = fetcher.get(sym, rng="2y")
        if bars is None or len(bars) < 30:
            return AgentResult(subtask_id=st.id, agent=AgentName.MARKET,
                               status=ResultStatus.UNAVAILABLE, confidence=0.0,
                               reasoning=[f"no price history for {sym}"])

        # Truncate to the cutoff. Slicing rather than trusting the feed is
        # what makes a historical replay honest.
        idx = len(bars)
        if as_of:
            k = bars.index_of(as_of)
            idx = (k + 1) if k is not None else sum(1 for d in bars.dates if d <= as_of)
        closes = bars.close[:idx]
        if len(closes) < 30:
            return AgentResult(subtask_id=st.id, agent=AgentName.MARKET,
                               status=ResultStatus.NO_DATA, confidence=0.0,
                               reasoning=[f"only {len(closes)} bars at or before {as_of}"])

        rets = [(closes[i] - closes[i - 1]) / closes[i - 1] for i in range(1, len(closes))]
        recent = rets[-60:]
        mean = sum(recent) / len(recent)
        vol_d = math.sqrt(sum((r - mean) ** 2 for r in recent) / max(1, len(recent) - 1))
        vol_a = vol_d * math.sqrt(252)

        ma20 = sum(closes[-20:]) / 20
        ma50 = sum(closes[-50:]) / 50 if len(closes) >= 50 else ma20
        last = closes[-1]
        trend = "up" if (last > ma20 > ma50) else ("down" if (last < ma20 < ma50) else "sideways")

        # Confidence from indicator agreement, not from self-assessment: an
        # unambiguous stack of price/MA20/MA50 is more informative than a
        # tangle of them, and that is observable.
        agree = sum([last > ma20, ma20 > ma50, last > ma50])
        confidence = {0: 0.75, 1: 0.4, 2: 0.4, 3: 0.75}[agree]

        return AgentResult(
            subtask_id=st.id, agent=AgentName.MARKET, status=ResultStatus.OK,
            payload={
                "ticker": sym, "close": last, "ma20": ma20, "ma50": ma50,
                "trend": trend, "volatility_annual_pct": vol_a * 100,
                "return_20d_pct": (last / closes[-21] - 1) * 100 if len(closes) > 21 else None,
                "bars_used": len(closes),
            },
            confidence=confidence,
            reasoning=[f"{trend} trend; close {last:.2f} vs MA20 {ma20:.2f}, MA50 {ma50:.2f}",
                       f"annualised volatility {vol_a * 100:.1f}% over 60 sessions"],
            as_of=bars.dates[idx - 1], data_window_start=bars.dates[0],
            data_window_end=bars.dates[idx - 1],
            is_live=(as_of is None), duration_ms=int((time.perf_counter() - t0) * 1000),
        )
    return adapter


# --------------------------------------------------------------------------
# Analyst
# --------------------------------------------------------------------------

def make_analyst_adapter(fetcher) -> "callable":
    """Directional forecast from the existing MarketForecaster."""

    def adapter(st: SubTask, as_of: Optional[str]) -> AgentResult:
        t0 = time.perf_counter()
        sym = _ticker_of(st)
        horizon = int(st.params.get("horizon_days") or 5)
        if not sym:
            return AgentResult(subtask_id=st.id, agent=AgentName.ANALYST,
                               status=ResultStatus.NO_DATA, confidence=0.0,
                               reasoning=["no ticker in subtask"])
        bars = fetcher.get(sym, rng="2y")
        if bars is None:
            return AgentResult(subtask_id=st.id, agent=AgentName.ANALYST,
                               status=ResultStatus.UNAVAILABLE, confidence=0.0,
                               reasoning=[f"no price history for {sym}"])

        idx = len(bars)
        if as_of:
            k = bars.index_of(as_of)
            idx = (k + 1) if k is not None else sum(1 for d in bars.dates if d <= as_of)
        if idx < 120:
            return AgentResult(subtask_id=st.id, agent=AgentName.ANALYST,
                               status=ResultStatus.NO_DATA, confidence=0.0,
                               reasoning=[f"needs 120 bars, have {idx}"])

        import pandas as pd
        from models.market_forecaster import MarketForecaster

        hist = pd.DataFrame({
            "Date": bars.dates[:idx], "Close": bars.close[:idx],
            "Volume": (bars.volume[:idx] if bars.volume else [float("nan")] * idx),
        })
        try:
            out = MarketForecaster().predict(
                hist, ticker=sym, query=f"{horizon} day outlook",
                sentiment_score=0.0, sentiment_level="neutral",
                data_source="yahoo-v8", market_history=None)
        except Exception as e:
            return AgentResult(subtask_id=st.id, agent=AgentName.ANALYST,
                               status=ResultStatus.ERROR, confidence=0.0,
                               reasoning=[f"{type(e).__name__}: {e}"])

        pct = next((float(out[k]) for k in
                    ("predictedReturnPct", "predicted_return_pct", "expectedReturnPct")
                    if isinstance(out.get(k), (int, float))), None)
        if pct is None:
            return AgentResult(subtask_id=st.id, agent=AgentName.ANALYST,
                               status=ResultStatus.ERROR, confidence=0.0,
                               reasoning=["forecaster returned no return field"])
        conf = next((float(out[k]) for k in ("confidence", "calibratedConfidence")
                     if isinstance(out.get(k), (int, float))), 50.0)

        return AgentResult(
            subtask_id=st.id, agent=AgentName.ANALYST, status=ResultStatus.OK,
            payload={"ticker": sym, "predicted_return_pct": pct,
                     "direction": "up" if pct > 0.05 else ("down" if pct < -0.05 else "flat"),
                     "horizon_days": horizon},
            confidence=conf / 100.0 if conf > 1.0 else conf,
            reasoning=[f"{horizon}-day predicted return {pct:+.2f}%"],
            as_of=bars.dates[idx - 1], data_window_end=bars.dates[idx - 1],
            duration_ms=int((time.perf_counter() - t0) * 1000),
        )
    return adapter


# --------------------------------------------------------------------------
# Risk
# --------------------------------------------------------------------------

def make_risk_adapter(fetcher) -> "callable":
    """Historical VaR, drawdown and a posture-consistent position size."""

    POSITION_BY_POSTURE = {"low": 0.06, "medium": 0.10, "high": 0.16}

    def adapter(st: SubTask, as_of: Optional[str]) -> AgentResult:
        t0 = time.perf_counter()
        sym = _ticker_of(st)
        posture = str(st.params.get("risk_posture") or "medium").lower()
        horizon = int(st.params.get("horizon_days") or 5)
        if not sym:
            return AgentResult(subtask_id=st.id, agent=AgentName.RISK,
                               status=ResultStatus.NO_DATA, confidence=0.0,
                               reasoning=["no ticker in subtask"])
        bars = fetcher.get(sym, rng="2y")
        if bars is None or len(bars) < 60:
            return AgentResult(subtask_id=st.id, agent=AgentName.RISK,
                               status=ResultStatus.UNAVAILABLE, confidence=0.0,
                               reasoning=[f"insufficient history for {sym}"])

        idx = len(bars)
        if as_of:
            k = bars.index_of(as_of)
            idx = (k + 1) if k is not None else sum(1 for d in bars.dates if d <= as_of)
        closes = bars.close[:idx]
        if len(closes) < 60:
            return AgentResult(subtask_id=st.id, agent=AgentName.RISK,
                               status=ResultStatus.NO_DATA, confidence=0.0,
                               reasoning=[f"only {len(closes)} bars at or before {as_of}"])

        rets = sorted((closes[i] - closes[i - 1]) / closes[i - 1]
                      for i in range(1, len(closes)))
        n = len(rets)
        var95_d = -rets[max(0, int(0.05 * n) - 1)]
        cvar_slice = rets[:max(1, int(0.05 * n))]
        cvar95_d = -sum(cvar_slice) / len(cvar_slice)
        var_h = var95_d * math.sqrt(horizon)     # sqrt-time scaling

        peak = closes[0]
        mdd = 0.0
        for c in closes:
            peak = max(peak, c)
            mdd = min(mdd, (c - peak) / peak)

        # More history means a better-resolved tail; 500 sessions is where
        # the 5% quantile stops moving much, so confidence saturates there.
        confidence = min(0.9, 0.35 + 0.55 * min(1.0, n / 500.0))

        return AgentResult(
            subtask_id=st.id, agent=AgentName.RISK, status=ResultStatus.OK,
            payload={"ticker": sym, "var95_daily_pct": var95_d * 100,
                     "cvar95_daily_pct": cvar95_d * 100,
                     "var95_horizon_pct": var_h * 100,
                     "max_drawdown_pct": mdd * 100,
                     "position_pct": POSITION_BY_POSTURE.get(posture, 0.10) * 100,
                     "risk_posture": posture, "samples": n},
            confidence=confidence,
            reasoning=[f"95% daily VaR {var95_d * 100:.2f}%, {horizon}-day {var_h * 100:.2f}%",
                       f"worst historical drawdown {mdd * 100:.1f}% over {n} sessions",
                       f"{posture} posture -> {POSITION_BY_POSTURE.get(posture, 0.10) * 100:.0f}% of capital"],
            as_of=bars.dates[idx - 1], data_window_end=bars.dates[idx - 1],
            duration_ms=int((time.perf_counter() - t0) * 1000),
        )
    return adapter


# --------------------------------------------------------------------------
# Researcher -- NewsAPI + FinBERT
# --------------------------------------------------------------------------

_FINBERT = None
_FINBERT_TRIED = False


def _finbert():
    """Lazy singleton. ~47s cold load, so never on the import path."""
    global _FINBERT, _FINBERT_TRIED
    if _FINBERT is None and not _FINBERT_TRIED:
        _FINBERT_TRIED = True
        try:
            from transformers import pipeline
            _FINBERT = pipeline("text-classification", model="ProsusAI/finbert",
                                device=-1, top_k=None)
        except Exception:
            _FINBERT = None
    return _FINBERT


def make_researcher_adapter(lookback_days: int = 7, max_articles: int = 15) -> "callable":
    """News sentiment: NewsAPI headlines scored by FinBERT, recency-weighted."""

    def adapter(st: SubTask, as_of: Optional[str]) -> AgentResult:
        t0 = time.perf_counter()
        sym = _ticker_of(st)
        key = _env("NEWSAPI_KEY")
        if not key:
            return AgentResult(subtask_id=st.id, agent=AgentName.RESEARCHER,
                               status=ResultStatus.UNAVAILABLE, confidence=0.0,
                               reasoning=["NEWSAPI_KEY not set"])

        cutoff = as_of or datetime.now(timezone.utc).date().isoformat()
        frm = (datetime.fromisoformat(cutoff) - timedelta(days=lookback_days)).date().isoformat()
        q = st.params.get("query") or sym or ""
        url = "https://newsapi.org/v2/everything?" + urllib.parse.urlencode({
            "q": q, "language": "en", "sortBy": "publishedAt",
            "pageSize": max_articles, "from": frm, "to": cutoff, "apiKey": key,
        })
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=_UA),
                                        timeout=25) as r:
                data = json.load(r)
        except Exception as e:
            return AgentResult(subtask_id=st.id, agent=AgentName.RESEARCHER,
                               status=ResultStatus.UNAVAILABLE, confidence=0.0,
                               reasoning=[f"NewsAPI: {type(e).__name__}: {e}"])

        arts = data.get("articles") or []
        # Belt and braces: NewsAPI honours `to`, but a decision must not
        # depend on a third party's date filter behaving.
        arts = [a for a in arts if (a.get("publishedAt") or "")[:10] <= cutoff]
        if not arts:
            return AgentResult(subtask_id=st.id, agent=AgentName.RESEARCHER,
                               status=ResultStatus.NO_DATA, confidence=0.0,
                               reasoning=[f"no articles for {q} in {frm}..{cutoff}"],
                               as_of=cutoff)

        clf = _finbert()
        if clf is None:
            return AgentResult(subtask_id=st.id, agent=AgentName.RESEARCHER,
                               status=ResultStatus.UNAVAILABLE, confidence=0.0,
                               reasoning=["FinBERT unavailable (transformers/torch missing)"],
                               as_of=cutoff)

        titles = [(a.get("title") or "")[:400] for a in arts if a.get("title")]
        try:
            scored = clf(titles)
        except Exception as e:
            return AgentResult(subtask_id=st.id, agent=AgentName.RESEARCHER,
                               status=ResultStatus.ERROR, confidence=0.0,
                               reasoning=[f"FinBERT: {type(e).__name__}: {e}"], as_of=cutoff)

        cutoff_d = datetime.fromisoformat(cutoff).date()
        num = den = 0.0
        evidence: List[Evidence] = []
        for art, dist in zip(arts, scored):
            d = {x["label"].lower(): x["score"] for x in dist}
            polarity = d.get("positive", 0.0) - d.get("negative", 0.0)
            pub = (art.get("publishedAt") or "")[:10]
            try:
                age = max(0, (cutoff_d - datetime.fromisoformat(pub).date()).days)
            except Exception:
                age = lookback_days
            w = 0.5 ** (age / 3.0)      # 3-day half-life
            num += polarity * w
            den += w
            if len(evidence) < 6:
                evidence.append(Evidence(
                    source=(art.get("source") or {}).get("name", "news"),
                    title=(art.get("title") or "")[:160],
                    url=art.get("url", ""), published_at=art.get("publishedAt"),
                    weight=round(w, 3)))

        score = num / den if den else 0.0
        level = "positive" if score > 0.15 else ("negative" if score < -0.15 else "neutral")
        # Agreement across articles, not volume: fifteen headlines that
        # contradict each other are weaker evidence than four that concur.
        pols = [x["score"] for dist in scored for x in dist if x["label"].lower() == "positive"]
        spread = (max(pols) - min(pols)) if len(pols) > 1 else 1.0
        confidence = max(0.2, min(0.85, (1.0 - spread) * 0.6 + min(1.0, len(arts) / 15) * 0.25))

        return AgentResult(
            subtask_id=st.id, agent=AgentName.RESEARCHER, status=ResultStatus.OK,
            payload={"ticker": sym, "sentiment_score": score, "level": level,
                     "articles": len(arts), "half_life_days": 3.0},
            confidence=confidence, evidence=evidence,
            reasoning=[f"{level} sentiment {score:+.3f} across {len(arts)} headlines",
                       "recency-weighted, 3-day half-life; scored by FinBERT"],
            as_of=cutoff, data_window_start=frm, data_window_end=cutoff,
            model="ProsusAI/finbert",
            duration_ms=int((time.perf_counter() - t0) * 1000),
        )
    return adapter


# --------------------------------------------------------------------------

def build_default_adapters(fetcher) -> Dict[AgentName, "callable"]:
    try:
        from .fundamentals import make_fundamentals_adapter
    except ImportError:
        from fundamentals import make_fundamentals_adapter  # type: ignore
    return {
        AgentName.MARKET: make_market_adapter(fetcher),
        AgentName.ANALYST: make_analyst_adapter(fetcher),
        AgentName.RISK: make_risk_adapter(fetcher),
        AgentName.RESEARCHER: make_researcher_adapter(),
        AgentName.FUNDAMENTALS: make_fundamentals_adapter(),
    }
