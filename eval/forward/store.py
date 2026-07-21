"""Append-only, tamper-evident store for forward-test predictions.

The forward test's whole claim is that its predictions could not have been
informed by their own outcomes. That claim rests on the storage layer, so
this module is deliberately rigid:

* **Append-only.** Records are written with ``"a"`` and never rewritten. There
  is no update path, because the ability to edit a prediction after the fact
  is exactly the ability to fake one.
* **Sealed.** Every record carries a SHA-256 over its own content. ``verify()``
  recomputes them, so silent edits are detectable rather than merely
  discouraged.
* **Outcomes are separate records.** A realised return is appended as its own
  row joined by ``decision_id``. The prediction row is never touched, so
  "we scored it later" cannot become "we changed it later".
* **Idempotent.** Keyed on (as_of, ticker, arm, horizon). Re-running the daily
  job cannot double-log, which matters because a scheduled job that retries
  after a partial failure is the normal case, not the exception.

Two files, both JSONL under ``root``: ``predictions.jsonl`` and
``outcomes.jsonl``.
"""

from __future__ import annotations

import hashlib
import json
import threading
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

DEFAULT_ROOT = Path(__file__).resolve().parent / "_runs"


def _utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def _seal(payload: Dict[str, Any]) -> str:
    body = {k: v for k, v in payload.items() if k != "seal"}
    return hashlib.sha256(
        json.dumps(body, sort_keys=True, default=str).encode()
    ).hexdigest()


@dataclass
class Prediction:
    """One sealed prediction for one ticker, one arm, one horizon.

    ``as_of`` is the last trading date whose *closing* data informed this
    prediction. It is the lookahead tripwire: no input may postdate it, and
    the outcome must be measured strictly after it.
    """

    decision_id: str
    created_at: str
    as_of: str                 # yyyy-mm-dd, last completed bar used
    arm: str                   # "A" numerical-only | "B" full agentic
    ticker: str
    horizon_days: int          # trading days ahead the call is made for

    direction: str             # up | down | flat
    confidence: float          # [0,1], self-reported
    position_pct: float = 0.0  # fraction of capital, if the arm sizes

    ref_close: Optional[float] = None   # close on as_of; the comparison basis
    # Compact per-agent payloads behind the call: predicted return, sentiment
    # score, volatility, VaR. Recorded because a trace without them is not
    # auditable -- the Auditor rejected early traces on exactly this ground,
    # since the rationale quoted figures that appeared nowhere in the
    # evidence it was shown. A decision record has to carry the numbers its
    # own explanation refers to.
    agent_evidence: Dict[str, Any] = field(default_factory=dict)
    # Volatility bucket at decision time. Stored rather than recomputed at
    # scoring time: an agent's reliability is conditioned on the regime it
    # was operating in, and recomputing later from a longer price series
    # would bucket the decision by conditions it never saw.
    regime: str = "unknown"
    intent: str = ""
    pipeline_version: str = "v2"
    planner_model: str = ""
    agents_used: List[str] = field(default_factory=list)
    fusion_weights: Dict[str, float] = field(default_factory=dict)
    rationale: str = ""
    llm_calls: int = 0
    duration_ms: int = 0
    degraded: bool = False     # True when a fallback path produced this
    seal: str = ""

    def key(self) -> Tuple[str, str, str, int]:
        return (self.as_of, self.ticker, self.arm, self.horizon_days)


@dataclass
class Outcome:
    decision_id: str
    evaluated_at: str
    eval_date: str             # trading date the outcome was measured on
    exit_close: float
    realized_return: float
    realized_direction: str
    correct: bool
    trading_days_elapsed: int
    seal: str = ""


class PredictionStore:
    def __init__(self, root: Path = DEFAULT_ROOT) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.pred_path = self.root / "predictions.jsonl"
        self.out_path = self.root / "outcomes.jsonl"
        self._lock = threading.Lock()

    # ---- writing ------------------------------------------------------

    def append(self, p: Prediction) -> bool:
        """Append a prediction. Returns False if its key already exists."""
        with self._lock:
            if p.key() in self._keys():
                return False
            row = asdict(p)
            row["seal"] = _seal(row)
            with self.pred_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(row, sort_keys=True) + "\n")
            return True

    def append_outcome(self, o: Outcome) -> bool:
        with self._lock:
            if o.decision_id in self._scored_ids():
                return False
            row = asdict(o)
            row["seal"] = _seal(row)
            with self.out_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(row, sort_keys=True) + "\n")
            return True

    # ---- reading ------------------------------------------------------

    def _iter(self, path: Path) -> Iterable[Dict[str, Any]]:
        if not path.exists():
            return
        with path.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        yield json.loads(line)
                    except json.JSONDecodeError:
                        continue

    def predictions(self) -> List[Dict[str, Any]]:
        return list(self._iter(self.pred_path))

    def outcomes(self) -> List[Dict[str, Any]]:
        return list(self._iter(self.out_path))

    def _keys(self) -> Set[Tuple[str, str, str, int]]:
        return {
            (r.get("as_of"), r.get("ticker"), r.get("arm"), r.get("horizon_days"))
            for r in self._iter(self.pred_path)
        }

    def _scored_ids(self) -> Set[str]:
        return {r.get("decision_id") for r in self._iter(self.out_path)}

    def unscored(self) -> List[Dict[str, Any]]:
        """Predictions with no outcome row yet."""
        done = self._scored_ids()
        return [p for p in self.predictions() if p.get("decision_id") not in done]

    # ---- integrity ----------------------------------------------------

    def verify(self) -> Dict[str, Any]:
        """Recompute every seal. A mismatch means a row was edited in place."""
        bad_pred, bad_out = [], []
        for r in self._iter(self.pred_path):
            if r.get("seal") != _seal(r):
                bad_pred.append(r.get("decision_id"))
        for r in self._iter(self.out_path):
            if r.get("seal") != _seal(r):
                bad_out.append(r.get("decision_id"))

        preds = self.predictions()
        # A duplicate key would mean the idempotency guard was bypassed.
        keys = [(r.get("as_of"), r.get("ticker"), r.get("arm"), r.get("horizon_days"))
                for r in preds]
        dupes = {k for k in keys if keys.count(k) > 1}

        # Lookahead tripwire: an outcome measured on or before its
        # prediction's as_of date would mean the "future" was already past.
        by_id = {p["decision_id"]: p for p in preds}
        bad_time = [
            o.get("decision_id") for o in self.outcomes()
            if o.get("decision_id") in by_id
            and o.get("eval_date", "") <= by_id[o["decision_id"]].get("as_of", "")
        ]

        return {
            "predictions": len(preds),
            "outcomes": len(self.outcomes()),
            "unscored": len(self.unscored()),
            "broken_seals_predictions": bad_pred,
            "broken_seals_outcomes": bad_out,
            "duplicate_keys": sorted(dupes),
            "outcomes_not_after_as_of": bad_time,
            "ok": not (bad_pred or bad_out or dupes or bad_time),
        }

    # ---- summary ------------------------------------------------------

    def summary(self) -> Dict[str, Any]:
        preds, outs = self.predictions(), self.outcomes()
        by_id = {p["decision_id"]: p for p in preds}
        arms: Dict[str, Dict[str, Any]] = {}
        for o in outs:
            p = by_id.get(o.get("decision_id"))
            if not p:
                continue
            a = arms.setdefault(p["arm"], {"n": 0, "correct": 0, "tickers": set()})
            a["n"] += 1
            a["correct"] += bool(o.get("correct"))
            a["tickers"].add(p["ticker"])
        for a in arms.values():
            a["accuracy"] = a["correct"] / a["n"] if a["n"] else None
            a["tickers"] = len(a["tickers"])
        dates = sorted({p["as_of"] for p in preds})
        return {
            "predictions": len(preds),
            "scored": len(outs),
            "date_range": [dates[0], dates[-1]] if dates else None,
            "trading_days": len(dates),
            "tickers": len({p["ticker"] for p in preds}),
            "arms": arms,
        }


def make_decision_id(as_of: str, ticker: str, arm: str, horizon: int) -> str:
    raw = f"{as_of}|{ticker}|{arm}|{horizon}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]
