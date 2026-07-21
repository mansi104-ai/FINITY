"""Frozen ticker universe for the forward test.

Fixed once, on the start date, and never revised. Two reasons:

**Survivorship bias runs backwards, not forwards.** Picking today's index
members and backtesting them is biased, because today's membership already
encodes which firms survived. Picking today's members and tracking them
*forward* is clean -- nothing about the future informed the choice. That is
one of the structural advantages of a forward test, and it is forfeited the
moment the list is edited mid-run.

**Power comes from breadth, not duration.** An earlier analysis put the
five-ticker study at 5.9% power to detect a +0.30 Sharpe difference; at that
rate no realistic run length settles anything. Widening to 40 names buys
roughly 40 predictions per trading day, so a three-month window yields on the
order of 2,400 -- enough for directional-accuracy and calibration claims,
which need hundreds rather than the tens of thousands a Sharpe comparison
would demand.

Selection rule, stated in advance so it cannot be retrofitted: large-cap US
equities, at least two per GICS sector, biased toward names with deep and
continuous price history. No screening on recent performance of any kind --
that would select on the outcome being measured.
"""

from __future__ import annotations

import hashlib
import json
from datetime import date
from pathlib import Path
from typing import Dict, List

MANIFEST_PATH = Path(__file__).resolve().parent / "universe.json"

# 40 names, >=2 per GICS sector. Frozen -- do not edit after the run starts.
UNIVERSE: Dict[str, List[str]] = {
    "information_technology": ["AAPL", "MSFT", "NVDA", "AVGO", "CRM", "AMD", "ORCL"],
    "communication_services": ["GOOGL", "META", "NFLX", "DIS"],
    "consumer_discretionary": ["AMZN", "TSLA", "HD", "MCD"],
    "consumer_staples":       ["PG", "KO", "COST", "WMT"],
    "financials":             ["JPM", "BAC", "GS", "BRK-B"],
    "health_care":            ["UNH", "JNJ", "LLY", "ABBV"],
    "industrials":            ["CAT", "BA", "HON", "UNP"],
    "energy":                 ["XOM", "CVX", "COP"],
    "utilities":              ["NEE", "DUK"],
    "real_estate":            ["PLD", "AMT"],
    "materials":              ["LIN", "SHW"],
}

# Benchmark series, fetched alongside but never predicted on. Supplies the
# cross-sectional market feature and the buy-and-hold reference.
BENCHMARK = "SPY"


def tickers() -> List[str]:
    return sorted(t for names in UNIVERSE.values() for t in names)


def sector_of(ticker: str) -> str:
    for sector, names in UNIVERSE.items():
        if ticker in names:
            return sector
    return "unknown"


def manifest_hash() -> str:
    return hashlib.sha256(
        json.dumps(UNIVERSE, sort_keys=True).encode()
    ).hexdigest()[:16]


def write_manifest(start_date: str | None = None) -> Dict:
    """Freeze the universe to disk. Refuses to overwrite an existing manifest.

    The refusal is the point: once a run has started, a changed universe
    invalidates the comparison, so this must fail loudly rather than quietly
    rewrite the record of what was promised.
    """
    if MANIFEST_PATH.exists():
        existing = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        if existing.get("hash") != manifest_hash():
            raise RuntimeError(
                f"universe.json exists with hash {existing.get('hash')} but the "
                f"code now hashes to {manifest_hash()}. The universe was edited "
                f"after the run started; revert the edit or start a new run "
                f"under a different root."
            )
        return existing

    payload = {
        "frozen_on": start_date or date.today().isoformat(),
        "hash": manifest_hash(),
        "benchmark": BENCHMARK,
        "n_tickers": len(tickers()),
        "n_sectors": len(UNIVERSE),
        "selection_rule": (
            "Large-cap US equities, at least two per GICS sector, chosen for "
            "depth of price history. No screening on past or recent returns."
        ),
        "sectors": UNIVERSE,
        "tickers": tickers(),
    }
    MANIFEST_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def load_manifest() -> Dict:
    if not MANIFEST_PATH.exists():
        return write_manifest()
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
