"""Optimizer Agent -- judges evidential sufficiency and re-queries when it helps.

Sits between the Router and the fusion layer. Given the agents' results it
decides whether they collectively support a decision, and if not, which agent
should be asked what instead.

It does not produce numbers. Numeric synthesis belongs to the weighting
function in ``fusion.py``, which is a function of measurable state and is
therefore auditable and backtestable. A language model asked to emit a weight
would be neither.

**A cheap conflict check runs before any LLM call.** Most queries are clear:
the agents agree, and paying a model to confirm it wastes a scarce free-tier
allowance. The LLM is consulted only when the deterministic screen finds a
real disagreement, which keeps the Optimizer inside roughly a third of a
45-call daily budget while still doing its job on the hard cases.

**Iteration is bounded twice over** -- by ``max_iterations`` and by the LLM
budget. An agent loop that can decide its own stopping condition is an agent
loop that can fail to stop, and a live forward test cannot afford either an
infinite loop or an exhausted quota.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

try:
    from ..contracts import (
        OPTIMIZER_PROMPT_VERSION, OPTIMIZER_SYSTEM, OPTIMIZER_VERDICT_SCHEMA,
        AgentName, AgentResult, ResultStatus, SubTask, TaskGraph,
    )
    from ..services.llm import get_llm
except ImportError:
    from contracts import (  # type: ignore
        OPTIMIZER_PROMPT_VERSION, OPTIMIZER_SYSTEM, OPTIMIZER_VERDICT_SCHEMA,
        AgentName, AgentResult, ResultStatus, SubTask, TaskGraph,
    )
    from services.llm import get_llm  # type: ignore


# Direction each agent implies, so disagreement can be detected without a model.
def _direction_of(r: AgentResult) -> Optional[str]:
    p = r.payload or {}
    if r.agent is AgentName.ANALYST:
        return p.get("direction")
    if r.agent is AgentName.MARKET:
        t = p.get("trend")
        return {"up": "up", "down": "down", "sideways": "flat"}.get(t)
    if r.agent is AgentName.RESEARCHER:
        lvl = p.get("level")
        return {"positive": "up", "negative": "down", "neutral": "flat"}.get(lvl)
    return None


def _describe(dirs: Dict[str, List[str]], abstained: List[str],
              non_voting: List[str], usable: List[AgentResult],
              results: List[AgentResult]) -> str:
    """Say what the evidence actually was, without inflating it.

    "Agreement" requires at least two agents pointing the same way. One
    directional call plus two silences is a single opinion, and describing it
    as consensus is the difference between a summary and a claim.
    """
    voters = [a for names in dirs.values() for a in names]
    parts: List[str] = []

    if not voters:
        parts.append("no agent expressed a direction")
    elif len(voters) == 1:
        d = next(iter(dirs))
        parts.append(f"one directional call ({voters[0]}: {d}), not a consensus")
    else:
        d = next(iter(dirs))
        parts.append(f"{len(voters)} agents agree ({d}): {', '.join(voters)}")

    if abstained:
        parts.append(f"{', '.join(abstained)} saw no direction")
    if non_voting:
        parts.append(f"{', '.join(non_voting)} informs sizing, not direction")

    n_failed = len(results) - len(usable)
    if n_failed:
        parts.append(f"{n_failed} agent(s) returned no evidence")

    return "; ".join(parts)


@dataclass
class OptimizerVerdict:
    sufficient: bool
    conflict: str = ""
    assessment: str = ""
    iterations: int = 0
    requeried: List[str] = field(default_factory=list)
    llm_calls: int = 0
    used_llm: bool = False
    screen_reason: str = ""
    duration_ms: int = 0


class OptimizerAgent:
    def __init__(self, llm=None, max_iterations: int = 2, memory=None) -> None:
        self.llm = llm if llm is not None else get_llm()
        self.max_iterations = max_iterations
        # Optional MemoryStore. Lessons are supplied to the LLM as *context
        # for judging sufficiency*, never as an input to the numeric
        # weighting: a free-text claim adjusting a weight would put an
        # unauditable term into every downstream number.
        self.memory = memory

    # ------------------------------------------------------------------
    def run(self, graph: TaskGraph, results: List[AgentResult],
            router=None, as_of: Optional[str] = None
            ) -> Tuple[List[AgentResult], OptimizerVerdict]:
        """Return possibly-improved results plus the verdict explaining why."""
        t0 = time.perf_counter()
        verdict = OptimizerVerdict(sufficient=True)

        for it in range(self.max_iterations):
            conflict, reason = self._screen(results)
            verdict.screen_reason = reason

            if not conflict:
                verdict.sufficient = True
                verdict.assessment = reason
                break

            # Genuine disagreement: now it is worth spending a call.
            plan = self._ask_llm(graph, results, as_of)
            if plan is None:
                # No budget or upstream down. Proceed on what we have and say
                # so, rather than blocking the pipeline on a nice-to-have.
                verdict.sufficient = True
                verdict.conflict = reason
                verdict.assessment = (
                    f"conflict detected ({reason}) but optimizer LLM unavailable "
                    f"({self.llm.last_error}); proceeding on existing evidence")
                break

            verdict.used_llm = True
            verdict.llm_calls += 1
            verdict.conflict = plan.get("conflict") or reason
            verdict.assessment = plan.get("assessment") or ""

            requeries = plan.get("requeries") or []
            if plan.get("sufficient") or not requeries or router is None:
                verdict.sufficient = bool(plan.get("sufficient"))
                break

            results = self._requery(graph, results, requeries, router, as_of, verdict, it + 1)
            verdict.iterations = it + 1
        else:
            # Loop exhausted without converging. Honest state: we stopped
            # because we hit the cap, not because the evidence resolved.
            verdict.sufficient = False
            verdict.assessment = (verdict.assessment or
                                  f"unresolved after {self.max_iterations} iterations")

        verdict.duration_ms = int((time.perf_counter() - t0) * 1000)
        return results, verdict

    # ------------------------------------------------------------------
    def _screen(self, results: List[AgentResult]) -> Tuple[bool, str]:
        """Deterministic conflict detector. True means 'worth an LLM call'.

        Deliberately conservative: it fires on directional opposition and on
        broad evidence failure, not on mere uncertainty. An agent that is
        honestly unsure about an unsure thing has done its job, and
        re-querying it would only spend budget to hear the same answer.
        """
        usable = [r for r in results if r.usable]
        if not usable:
            return False, "no usable agent results; nothing to reconcile"

        # Three distinct populations, kept apart on purpose. An earlier
        # version collapsed them and reported "agents agree (up); 3/3
        # returned evidence" for a case where exactly one agent said up, one
        # abstained with a sideways read, and one (risk) casts no directional
        # vote at all. The fused number was right -- the abstention correctly
        # dragged the score from 1.00 to 0.57 -- but the sentence claimed a
        # consensus that did not exist, and that sentence is what a user
        # reads and what the research record stores.
        dirs: Dict[str, List[str]] = {}
        abstained: List[str] = []
        non_voting: List[str] = []
        for r in usable:
            d = _direction_of(r)
            if d is None:
                non_voting.append(r.agent.value)
            elif d == "flat":
                abstained.append(r.agent.value)
            else:
                dirs.setdefault(d, []).append(r.agent.value)

        if "up" in dirs and "down" in dirs:
            return True, (f"directional conflict: {', '.join(dirs['up'])} say up "
                          f"while {', '.join(dirs['down'])} say down")

        failed = [r.agent.value for r in results
                  if r.status in (ResultStatus.ERROR, ResultStatus.UNAVAILABLE)]
        if len(failed) > len(results) / 2:
            return True, f"majority of agents returned no evidence: {', '.join(failed)}"

        return False, _describe(dirs, abstained, non_voting, usable, results)

    # ------------------------------------------------------------------
    def _ask_llm(self, graph: TaskGraph, results: List[AgentResult],
                 as_of: Optional[str] = None) -> Optional[Dict]:
        lines = []
        for r in results:
            lines.append(
                f"- subtask {r.subtask_id} [{r.agent.value}] status={r.status.value} "
                f"confidence={r.confidence:.2f}\n"
                f"  payload: {r.payload}\n"
                f"  notes: {'; '.join(r.reasoning[:2])}")

        # Point-in-time recall: `recall` returns only lessons learned strictly
        # before `as_of`, so a decision can never be informed by a lesson
        # derived from its own day's traces. With no as_of we are serving
        # live, and everything already learned is legitimately available.
        memo = ""
        if self.memory is not None:
            try:
                scope = graph.tickers[0] if graph.tickers else None
                lessons = self.memory.recall(as_of or "9999-12-31",
                                             scope=scope, limit=5)
                if lessons:
                    memo = ("\n\nPrior lessons from audited past decisions "
                            "(context only -- they do not override today's "
                            "evidence):\n" + "\n".join(
                                f"- [{x.scope}, seen {x.times_seen}x] {x.claim}"
                                for x in lessons))
            except Exception:
                memo = ""

        user = (
            f"User intent: {graph.intent.value}\n"
            f"Securities: {', '.join(graph.tickers) or 'n/a'}\n"
            f"Horizon: {graph.horizon_days} days | risk posture: {graph.risk_posture.value}\n\n"
            f"Agent results:\n" + "\n".join(lines) + memo)

        res = self.llm.complete_json(
            system=OPTIMIZER_SYSTEM, user=user,
            schema=OPTIMIZER_VERDICT_SCHEMA, schema_name="optimizer_verdict",
            category="optimizer",
            # Not cached: the verdict depends on today's specific numbers, so
            # a cache hit would be a stale judgement rather than a saving.
            cache_key=None, max_tokens=1200)
        return res.data if res else None

    # ------------------------------------------------------------------
    def _requery(self, graph: TaskGraph, results: List[AgentResult],
                 requeries: List[Dict], router, as_of: Optional[str],
                 verdict: OptimizerVerdict, iteration: int) -> List[AgentResult]:
        by_id = {r.subtask_id: r for r in results}
        originals = {st.id: st for st in graph.subtasks}
        fresh: List[SubTask] = []

        for rq in requeries:
            sid = rq.get("subtask_id")
            question = (rq.get("revised_question") or "").strip()
            base = originals.get(sid)
            if not base or not question:
                continue
            prior = by_id.get(sid)
            # Never re-query a dead source: the data is missing, not the
            # question wrong, so a rephrasing cannot help and would only
            # spend time and budget.
            if prior and prior.status in (ResultStatus.UNAVAILABLE, ResultStatus.NO_DATA):
                continue
            fresh.append(SubTask(id=base.id, agent=base.agent, question=question,
                                 priority=base.priority, params=dict(base.params),
                                 acceptance=base.acceptance))

        if not fresh:
            return results

        sub = TaskGraph(intent=graph.intent, tickers=list(graph.tickers),
                        horizon_days=graph.horizon_days,
                        risk_posture=graph.risk_posture, subtasks=fresh)
        redone = router.dispatch(sub, as_of=as_of)

        merged = {r.subtask_id: r for r in results}
        for r in redone:
            r.iteration = iteration
            prior = merged.get(r.subtask_id)
            # Keep the better-evidenced answer. A re-query that comes back
            # empty must not destroy a usable first attempt.
            if prior is not None and prior.usable and not r.usable:
                continue
            merged[r.subtask_id] = r
            verdict.requeried.append(f"{r.agent.value}:{r.subtask_id}")

        return [merged[st.id] for st in graph.subtasks if st.id in merged]
