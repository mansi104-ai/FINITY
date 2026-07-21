"""Auditor and memory curator -- self-review and durable memory.

Two jobs, both run once a day rather than per request, which is what keeps
them inside a free-tier budget: one batched call can review forty traces.

**Auditor.** Reviews completed decision traces and judges whether the stated
reasoning actually follows from the evidence gathered. It grades *process,
not outcome*: a well-reasoned decision that lost money is sound, and a
badly-reasoned one that made money is not. Grading on outcomes would simply
relabel luck as skill, and in a five-day-horizon equity task most single
outcomes are luck.

**Curator.** Maintains the memory store each morning: promotes lessons that
keep earning their place, retires ones that have gone stale or been
contradicted, and enforces a size cap so memory cannot grow without bound.

Point-in-time correctness is the constraint that shapes the whole design. A
lesson learned on day t+5 must never inform a decision replayed at day t --
that is lookahead wearing a different hat, and it is easy to introduce
accidentally because memory feels like "background knowledge" rather than
data. Every entry therefore records ``learned_on``, and ``recall()`` refuses
to return anything learned on or after the requesting decision's ``as_of``.
"""

from __future__ import annotations

import hashlib
import json
import threading
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from ..contracts import AUDIT_SCHEMA, AUDITOR_SYSTEM, AUDITOR_PROMPT_VERSION
    from ..services.llm import get_llm
except ImportError:
    from contracts import AUDIT_SCHEMA, AUDITOR_SYSTEM, AUDITOR_PROMPT_VERSION  # type: ignore
    from services.llm import get_llm  # type: ignore


DEFAULT_MEMORY = Path(__file__).resolve().parents[2] / "eval" / "forward" / "_memory"
MAX_LESSONS = 200


@dataclass
class Lesson:
    """A durable, falsifiable claim earned from reviewing traces."""

    lesson_id: str
    claim: str
    scope: str                       # ticker, sector, regime, or "global"
    learned_on: str                  # yyyy-mm-dd -- the lookahead guard
    evidence_decision_ids: List[str] = field(default_factory=list)
    times_seen: int = 1
    last_seen_on: str = ""
    retired_on: Optional[str] = None
    retired_reason: str = ""

    @property
    def active(self) -> bool:
        return self.retired_on is None


class MemoryStore:
    """Append-mostly JSONL memory with point-in-time recall."""

    def __init__(self, root: Path = DEFAULT_MEMORY) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / "lessons.jsonl"
        self._lock = threading.Lock()

    def _all(self) -> List[Lesson]:
        if not self.path.exists():
            return []
        out = []
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                try:
                    out.append(Lesson(**json.loads(line)))
                except Exception:
                    continue
        return out

    def _rewrite(self, lessons: List[Lesson]) -> None:
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text("".join(json.dumps(asdict(x), sort_keys=True) + "\n"
                               for x in lessons), encoding="utf-8")
        tmp.replace(self.path)

    # ---- writing ------------------------------------------------------

    def add(self, claim: str, scope: str, learned_on: str,
            evidence: Optional[List[str]] = None) -> Optional[Lesson]:
        """Add a lesson, or reinforce an identical one already held."""
        with self._lock:
            lessons = self._all()
            key = hashlib.sha256(f"{scope}|{claim.strip().lower()}".encode()
                                 ).hexdigest()[:16]
            for x in lessons:
                if x.lesson_id == key and x.active:
                    # Seen again: strengthen rather than duplicate. Repeated
                    # independent observation is the only evidence of
                    # durability available here.
                    x.times_seen += 1
                    x.last_seen_on = learned_on
                    x.evidence_decision_ids = (
                        x.evidence_decision_ids + (evidence or []))[-20:]
                    self._rewrite(lessons)
                    return x
            lesson = Lesson(lesson_id=key, claim=claim.strip(), scope=scope,
                            learned_on=learned_on, last_seen_on=learned_on,
                            evidence_decision_ids=(evidence or [])[:20])
            lessons.append(lesson)
            self._rewrite(lessons)
            return lesson

    # ---- reading ------------------------------------------------------

    def recall(self, as_of: str, scope: Optional[str] = None,
               limit: int = 10) -> List[Lesson]:
        """Lessons available to a decision dated ``as_of``.

        Strictly earlier than ``as_of``: a lesson learned *on* the decision
        date was derived from that day's own traces, so returning it would
        let a decision be informed by its own outcome. This is the single
        most important line in the module.
        """
        out = [x for x in self._all()
               if x.active and x.learned_on < as_of
               and (scope is None or x.scope in (scope, "global"))]
        out.sort(key=lambda x: (-x.times_seen, x.learned_on))
        return out[:limit]

    def active(self) -> List[Lesson]:
        return [x for x in self._all() if x.active]

    def stats(self) -> Dict[str, Any]:
        all_ = self._all()
        return {"total": len(all_),
                "active": sum(1 for x in all_ if x.active),
                "retired": sum(1 for x in all_ if not x.active),
                "scopes": sorted({x.scope for x in all_ if x.active})}


class AuditorAgent:
    """Batched post-hoc review of decision traces."""

    def __init__(self, llm=None, memory: Optional[MemoryStore] = None) -> None:
        self.llm = llm if llm is not None else get_llm()
        self.memory = memory or MemoryStore()

    def review(self, traces: List[Dict[str, Any]],
               on_date: Optional[str] = None, max_traces: int = 100) -> Dict[str, Any]:
        """Review traces in one call. Returns the audit plus lessons stored.

        The cap is 100 rather than 40 because a two-arm day over 40 tickers
        produces 80 traces, and a cap of 40 silently reviewed only one arm's
        worth. The primary model carries a 1M-token context, so one call
        comfortably holds the day.
        """
        on_date = on_date or date.today().isoformat()
        if not traces:
            return {"reviewed": 0, "lessons_added": 0, "skipped": "no traces"}

        batch = traces[:max_traces]
        lines = []
        for t in batch:
            # `evidence` carries the per-agent figures the rationale quotes.
            # Omitting it made every trace unauditable: the Auditor rejected
            # them wholesale because the rationale cited returns and regimes
            # that appeared nowhere in what it had been shown, and it was
            # right to.
            lines.append(
                f"- id={t.get('decision_id')} {t.get('ticker')} arm={t.get('arm')} "
                f"as_of={t.get('as_of')}\n"
                f"  call: {t.get('direction')} conf={t.get('confidence')} "
                f"position={t.get('position_pct')}%\n"
                f"  agents: {t.get('agents_used')}  weights: {t.get('fusion_weights')}\n"
                f"  evidence: {t.get('agent_evidence') or 'NOT RECORDED'}\n"
                f"  rationale: {t.get('rationale')}")

        res = self.llm.complete_json(
            system=AUDITOR_SYSTEM,
            user=("Review these decision traces. Outcomes are deliberately not "
                  "shown -- judge whether each rationale follows from the "
                  "evidence listed.\n\n" + "\n".join(lines)),
            schema=AUDIT_SCHEMA, schema_name="audit", category="auditor",
            cache_key=None, max_tokens=2500)

        if res is None:
            return {"reviewed": 0, "lessons_added": 0,
                    "error": self.llm.last_error or "auditor LLM unavailable"}

        data = res.data
        unsound = [d for d in data.get("decisions", []) if not d.get("sound")]
        added = 0
        for les in data.get("lessons", []):
            claim = (les.get("claim") or "").strip()
            if not claim:
                continue
            if self.memory.add(claim=claim, scope=(les.get("scope") or "global").strip(),
                               learned_on=on_date,
                               evidence=les.get("evidence_decision_ids") or []):
                added += 1

        return {"reviewed": len(batch), "unsound": len(unsound),
                "unsound_ids": [d.get("decision_id") for d in unsound][:10],
                "lessons_added": added, "model": res.model,
                "memory": self.memory.stats()}


class CuratorAgent:
    """Morning maintenance: retire stale lessons, enforce the size cap.

    Deliberately deterministic. Deciding what to forget by asking a language
    model would make memory contents depend on an unauditable judgement that
    varies run to run, and memory is an input to every later decision.
    """

    def __init__(self, memory: Optional[MemoryStore] = None,
                 stale_days: int = 90, max_lessons: int = MAX_LESSONS) -> None:
        self.memory = memory or MemoryStore()
        self.stale_days = stale_days
        self.max_lessons = max_lessons

    def curate(self, on_date: Optional[str] = None) -> Dict[str, Any]:
        on_date = on_date or date.today().isoformat()
        today = datetime.fromisoformat(on_date).date()
        lessons = self.memory._all()
        retired_stale = retired_capped = 0

        for x in lessons:
            if not x.active:
                continue
            last = x.last_seen_on or x.learned_on
            try:
                age = (today - datetime.fromisoformat(last).date()).days
            except Exception:
                continue
            # Seen once and long ago is a coincidence that never recurred.
            # Repeatedly reinforced lessons get proportionally longer to live.
            allowance = self.stale_days * min(4, max(1, x.times_seen))
            if age > allowance:
                x.retired_on = on_date
                x.retired_reason = f"not reinforced in {age}d (allowance {allowance}d)"
                retired_stale += 1

        active = [x for x in lessons if x.active]
        if len(active) > self.max_lessons:
            # Keep the best-evidenced; retire the weakest.
            active.sort(key=lambda x: (x.times_seen, x.last_seen_on), reverse=True)
            for x in active[self.max_lessons:]:
                x.retired_on = on_date
                x.retired_reason = f"exceeded cap of {self.max_lessons}"
                retired_capped += 1

        self.memory._rewrite(lessons)
        return {"date": on_date, "retired_stale": retired_stale,
                "retired_over_cap": retired_capped, **self.memory.stats()}
