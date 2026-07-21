"""Fundamentals agent -- Yahoo quoteSummary via the cookie+crumb flow.

Yahoo's ``v7/finance/quote`` is IP-blocked from cloud hosts, but
``v10/finance/quoteSummary`` is only *auth*-gated: fetch a cookie from
fc.yahoo.com, exchange it for a crumb, then pass both. The crumb is good for
roughly an hour and is cached for the process.

**This adapter refuses historical dates, on purpose.** quoteSummary returns
whatever the fundamentals are *now* -- there is no point-in-time parameter.
Serving today's P/E for a decision dated three months ago would be textbook
lookahead, and it would be entirely invisible downstream because the number
looks perfectly ordinary. So when ``as_of`` is older than a couple of days
the adapter returns UNAVAILABLE and says why, rather than returning a figure
that cannot be trusted.

**Fundamentals inform but do not vote.** Valuation and growth are recorded as
evidence and feed the write-up, but the agent casts no directional call. The
one field that would supply one, ``recommendationKey``, is a broker consensus
-- routing it into the fusion would mean reporting other analysts' forecasts
as FINDEC's own. It is recorded as evidence and excluded from the vote.
"""

from __future__ import annotations

import http.cookiejar
import json
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from typing import Any, Dict, Optional

try:
    from ..contracts import AgentName, AgentResult, Evidence, ResultStatus, SubTask
except ImportError:
    from contracts import AgentName, AgentResult, Evidence, ResultStatus, SubTask  # type: ignore

_UA = {"User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/122 Safari/537.36")}
_MODULES = "summaryDetail,defaultKeyStatistics,financialData"

# How stale an as_of may be before we refuse. Two days covers a weekend gap
# between a Friday close and a Monday run; beyond that, current fundamentals
# are not what the decision would have seen.
MAX_AS_OF_AGE_DAYS = 3

_crumb: Optional[str] = None
_crumb_at: float = 0.0
_opener = None


def _session():
    global _opener
    if _opener is None:
        cj = http.cookiejar.CookieJar()
        _opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    return _opener


def _get_crumb(force: bool = False) -> Optional[str]:
    """Cookie -> crumb, cached ~50 minutes."""
    global _crumb, _crumb_at
    if _crumb and not force and (time.time() - _crumb_at) < 3000:
        return _crumb
    op = _session()
    try:
        # fc.yahoo.com answers 404 but still sets the cookie we need, so the
        # error is expected and deliberately swallowed.
        op.open(urllib.request.Request("https://fc.yahoo.com", headers=_UA), timeout=20)
    except Exception:
        pass
    try:
        r = op.open(urllib.request.Request(
            "https://query1.finance.yahoo.com/v1/test/getcrumb", headers=_UA), timeout=20)
        c = r.read().decode().strip()
        if c and len(c) < 40:
            _crumb, _crumb_at = c, time.time()
            return c
    except Exception:
        pass
    return None


def _raw(d: Dict[str, Any], *path) -> Optional[float]:
    cur: Any = d
    for k in path:
        cur = (cur or {}).get(k)
        if cur is None:
            return None
    if isinstance(cur, dict):
        cur = cur.get("raw")
    return cur if isinstance(cur, (int, float)) else None


def fetch(symbol: str) -> Optional[Dict[str, Any]]:
    crumb = _get_crumb()
    if not crumb:
        return None
    url = (f"https://query1.finance.yahoo.com/v10/finance/quoteSummary/{symbol}"
           f"?modules={_MODULES}&crumb={urllib.parse.quote(crumb)}")
    try:
        d = json.load(_session().open(
            urllib.request.Request(url, headers=_UA), timeout=25))
        return (d.get("quoteSummary", {}).get("result") or [None])[0]
    except Exception:
        # A stale crumb reads as 401/403; refresh once and retry.
        crumb = _get_crumb(force=True)
        if not crumb:
            return None
        try:
            url = (f"https://query1.finance.yahoo.com/v10/finance/quoteSummary/{symbol}"
                   f"?modules={_MODULES}&crumb={urllib.parse.quote(crumb)}")
            d = json.load(_session().open(
                urllib.request.Request(url, headers=_UA), timeout=25))
            return (d.get("quoteSummary", {}).get("result") or [None])[0]
        except Exception:
            return None


def make_fundamentals_adapter():
    def adapter(st: SubTask, as_of: Optional[str]) -> AgentResult:
        t0 = time.perf_counter()
        sym = (st.params.get("ticker") or "").upper()
        if not sym:
            return AgentResult(subtask_id=st.id, agent=AgentName.FUNDAMENTALS,
                               status=ResultStatus.NO_DATA, confidence=0.0,
                               reasoning=["no ticker in subtask"])

        today = datetime.now(timezone.utc).date()
        if as_of:
            try:
                age = (today - date.fromisoformat(as_of)).days
            except Exception:
                age = 0
            if age > MAX_AS_OF_AGE_DAYS:
                # The refusal is the feature -- see module docstring.
                return AgentResult(
                    subtask_id=st.id, agent=AgentName.FUNDAMENTALS,
                    status=ResultStatus.UNAVAILABLE, confidence=0.0,
                    reasoning=[f"quoteSummary reports current fundamentals only; "
                               f"as_of={as_of} is {age}d old, so serving them "
                               f"would be lookahead"],
                    as_of=as_of)

        res = fetch(sym)
        if not res:
            return AgentResult(subtask_id=st.id, agent=AgentName.FUNDAMENTALS,
                               status=ResultStatus.UNAVAILABLE, confidence=0.0,
                               reasoning=[f"Yahoo quoteSummary unavailable for {sym}"])

        sd, ks, fd = (res.get("summaryDetail") or {},
                      res.get("defaultKeyStatistics") or {},
                      res.get("financialData") or {})
        payload = {
            "ticker": sym,
            "trailing_pe": _raw(sd, "trailingPE"),
            "forward_pe": _raw(sd, "forwardPE"),
            "market_cap": _raw(sd, "marketCap"),
            "beta": _raw(sd, "beta"),
            "dividend_yield": _raw(sd, "dividendYield"),
            "price_to_book": _raw(ks, "priceToBook"),
            "profit_margin": _raw(fd, "profitMargins"),
            "revenue_growth": _raw(fd, "revenueGrowth"),
            "debt_to_equity": _raw(fd, "debtToEquity"),
            # Broker consensus. Evidence only -- deliberately not a vote.
            "analyst_recommendation": fd.get("recommendationKey"),
        }
        present = [k for k, v in payload.items()
                   if v is not None and k not in ("ticker",)]
        if not present:
            return AgentResult(subtask_id=st.id, agent=AgentName.FUNDAMENTALS,
                               status=ResultStatus.NO_DATA, confidence=0.0,
                               reasoning=[f"no fundamentals populated for {sym}"])

        # Confidence tracks field coverage: a thinly-covered name yields a
        # thinner picture, and that is observable rather than asserted.
        confidence = min(0.85, 0.25 + 0.06 * len(present))

        notes = []
        if payload["trailing_pe"]:
            notes.append(f"trailing P/E {payload['trailing_pe']:.1f}")
        if payload["revenue_growth"] is not None:
            notes.append(f"revenue growth {payload['revenue_growth'] * 100:+.1f}%")
        if payload["profit_margin"] is not None:
            notes.append(f"profit margin {payload['profit_margin'] * 100:.1f}%")

        return AgentResult(
            subtask_id=st.id, agent=AgentName.FUNDAMENTALS, status=ResultStatus.OK,
            payload=payload, confidence=confidence,
            reasoning=["; ".join(notes) or f"{len(present)} fundamentals retrieved",
                       "valuation and growth recorded as evidence; this agent "
                       "casts no directional vote"],
            evidence=[Evidence(source="Yahoo quoteSummary", title=f"{sym} fundamentals",
                               published_at=datetime.now(timezone.utc).isoformat())],
            as_of=today.isoformat(), is_live=True,
            duration_ms=int((time.perf_counter() - t0) * 1000),
        )
    return adapter
