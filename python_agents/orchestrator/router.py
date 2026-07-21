"""Router -- dispatches a TaskGraph's subtasks to the agents it names.

This is the piece that makes the plan load-bearing. The v1 orchestrator ran a
fixed sequence and consulted the planner's output for nothing; here the set of
agents that run *is* ``graph.subtasks``, so a plan that omits an agent
genuinely skips the work and a plan that adds one genuinely does it.

Execution respects ``depends_on`` and runs everything else concurrently.
Dependencies are honoured in waves rather than by a full topological sort:
with at most a handful of subtasks per query the difference is immaterial,
and waves keep the failure semantics obvious.

No agent failure propagates. A dead data source yields
``ResultStatus.UNAVAILABLE`` and the pipeline continues with less evidence,
which is the correct behaviour for a system whose whole job is weighing
partial evidence -- and which the fusion layer can then down-weight, because
"we could not see this" is different information from "we looked and found
nothing".
"""

from __future__ import annotations

import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from typing import Callable, Dict, List, Optional

try:
    from ..contracts import AgentName, AgentResult, ResultStatus, SubTask, TaskGraph
except ImportError:  # script import
    from contracts import AgentName, AgentResult, ResultStatus, SubTask, TaskGraph  # type: ignore


# Signature every adapter implements. `as_of` is the point-in-time cutoff:
# an adapter must not consult anything published after it.
Adapter = Callable[[SubTask, Optional[str]], AgentResult]


def _err(st: SubTask, status: ResultStatus, msg: str, t0: float) -> AgentResult:
    return AgentResult(
        subtask_id=st.id, agent=st.agent, status=status,
        confidence=0.0, reasoning=[msg],
        duration_ms=int((time.perf_counter() - t0) * 1000),
    )


class Router:
    def __init__(self, adapters: Dict[AgentName, Adapter],
                 max_workers: int = 5, timeout_s: float = 120.0) -> None:
        self.adapters = adapters
        self.max_workers = max_workers
        self.timeout_s = timeout_s

    # ------------------------------------------------------------------
    def dispatch(self, graph: TaskGraph, as_of: Optional[str] = None) -> List[AgentResult]:
        """Run every subtask in ``graph``. Returns one result per subtask."""
        if not graph.subtasks:
            return []   # e.g. intent=define, which is terminal by design

        inject_params(graph)

        results: Dict[str, AgentResult] = {}
        remaining = list(graph.subtasks)

        while remaining:
            # A wave is every subtask whose dependencies have already run.
            wave = [st for st in remaining
                    if all(d in results for d in st.depends_on)]
            if not wave:
                # Cycle, or a dependency that failed to produce a result.
                # TaskGraph validates dangling references at construction, so
                # this means a cycle; fail those subtasks rather than hang.
                for st in remaining:
                    results[st.id] = _err(
                        st, ResultStatus.ERROR,
                        "unresolvable dependency cycle", time.perf_counter())
                break

            with ThreadPoolExecutor(max_workers=min(self.max_workers, len(wave))) as pool:
                futures = {pool.submit(self._run_one, st, as_of): st for st in wave}
                for fut, st in futures.items():
                    t0 = time.perf_counter()
                    try:
                        results[st.id] = fut.result(timeout=self.timeout_s)
                    except TimeoutError:
                        results[st.id] = _err(st, ResultStatus.UNAVAILABLE,
                                              f"timed out after {self.timeout_s}s", t0)
                    except Exception as e:
                        results[st.id] = _err(st, ResultStatus.ERROR,
                                              f"{type(e).__name__}: {e}", t0)

            done = {st.id for st in wave}
            remaining = [st for st in remaining if st.id not in done]

        return [results[st.id] for st in graph.subtasks if st.id in results]

    # ------------------------------------------------------------------
    def _run_one(self, st: SubTask, as_of: Optional[str]) -> AgentResult:
        t0 = time.perf_counter()
        adapter = self.adapters.get(st.agent)
        if adapter is None:
            return _err(st, ResultStatus.UNAVAILABLE,
                        f"no adapter registered for '{st.agent.value}'", t0)
        try:
            res = adapter(st, as_of)
        except Exception:
            return _err(st, ResultStatus.ERROR,
                        traceback.format_exc(limit=2).strip().splitlines()[-1], t0)

        if not res.duration_ms:
            res.duration_ms = int((time.perf_counter() - t0) * 1000)
        # Lookahead tripwire at the boundary: an adapter that reports data
        # newer than the cutoff is a bug, and returning it would silently
        # poison the decision it feeds.
        if as_of and res.as_of and res.as_of > as_of:
            return _err(st, ResultStatus.ERROR,
                        f"adapter returned as_of={res.as_of} newer than cutoff {as_of}", t0)
        return res


# --------------------------------------------------------------------------
# Adapter helpers
# --------------------------------------------------------------------------

def inject_params(graph: TaskGraph) -> TaskGraph:
    """Push graph-level facts down into each subtask's ``params``.

    The language model writes prose questions but does not reliably fill
    structured fields, and numeric agents must never have to parse prose to
    find a ticker. The graph already resolved the symbol, horizon and posture,
    so they are copied down rather than re-derived. Existing values are left
    alone: a subtask that names its own ticker (as in a comparison) outranks
    the graph default.
    """
    primary = graph.tickers[0] if graph.tickers else None
    for st in graph.subtasks:
        st.params.setdefault("horizon_days", graph.horizon_days)
        st.params.setdefault("risk_posture", graph.risk_posture.value)
        st.params.setdefault("intent", graph.intent.value)
        if "ticker" not in st.params:
            # Prefer a symbol the subtask itself names -- a compare plan has
            # one subtask per security and must not collapse onto tickers[0].
            named = [t for t in graph.tickers if t in st.question]
            st.params["ticker"] = named[0] if len(named) == 1 else primary
        if "query" not in st.params and st.params.get("ticker"):
            st.params["query"] = st.params["ticker"]
    return graph


def unavailable_adapter(reason: str) -> Adapter:
    """An adapter for an agent that is not wired yet.

    Deliberately returns UNAVAILABLE rather than a plausible-looking neutral
    value. A fabricated neutral reading is indistinguishable downstream from
    a real one, so it would quietly enter the fusion weighting as evidence.
    """
    def _adapter(st: SubTask, as_of: Optional[str]) -> AgentResult:
        return AgentResult(
            subtask_id=st.id, agent=st.agent, status=ResultStatus.UNAVAILABLE,
            confidence=0.0, reasoning=[reason],
        )
    return _adapter


def utc_today() -> str:
    return datetime.now(timezone.utc).date().isoformat()
