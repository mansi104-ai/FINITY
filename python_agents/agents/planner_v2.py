"""Planner Agent -- query to executable task graph.

Replaces the v1 planner, which matched keywords and then emitted a `needs`
dict that crew.py ignored: it always set research/market/risk to True and
its own comment conceded that emphasis keywords "do not disable a source".
A plan nothing consumes is not a plan.

Here the TaskGraph *is* the execution plan. The router dispatches exactly
the subtasks listed and nothing else, so dropping a subtask genuinely skips
that agent.

Two invariants are enforced after the model returns, not requested of it in
the prompt, because a prompt is a hope and a post-condition is a guarantee:

  * `define` dispatches nothing.
  * `advice` and `risk_check` always carry a risk subtask.

The deterministic fallback is retained but demoted. It exists so a live
forward test survives an upstream outage with a logged, clearly-labelled
degradation -- never to be the normal path. `plan.planned_by` records which
route produced the plan so degraded days are excluded from control-plane
metrics rather than silently averaged in.
"""

from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Optional

try:
    from ..contracts import (
        CAPITAL_AT_RISK_INTENTS,
        DEFAULT_AGENTS,
        PLANNER_PROMPT_VERSION,
        PLANNER_SYSTEM,
        TASK_GRAPH_SCHEMA,
        AgentName,
        Intent,
        RiskPosture,
        SubTask,
        TaskGraph,
    )
    from ..services.llm import get_llm, stable_key
except ImportError:  # direct/script import
    from contracts import (  # type: ignore
        CAPITAL_AT_RISK_INTENTS,
        DEFAULT_AGENTS,
        PLANNER_PROMPT_VERSION,
        PLANNER_SYSTEM,
        TASK_GRAPH_SCHEMA,
        AgentName,
        Intent,
        RiskPosture,
        SubTask,
        TaskGraph,
    )
    from services.llm import get_llm, stable_key  # type: ignore


_HORIZON_UNITS = {
    "day": 1, "days": 1, "week": 7, "weeks": 7, "wk": 7, "wks": 7,
    "month": 30, "months": 30, "mo": 30, "mos": 30,
    "year": 365, "years": 365, "yr": 365, "yrs": 365,
}
_HORIZON_RE = re.compile(
    r"(\d+)\s*(days?|weeks?|wks?|months?|mos?|years?|yrs?)\b", re.IGNORECASE)
_TICKER_RE = re.compile(r"\b([A-Z]{1,5})\b")

# Only for the degraded path. Deliberately tiny: a large table here would
# invite the fallback to masquerade as competent.
_NAME_TO_TICKER = {
    "apple": "AAPL", "nvidia": "NVDA", "microsoft": "MSFT", "tesla": "TSLA",
    "amazon": "AMZN", "google": "GOOGL", "alphabet": "GOOGL", "meta": "META",
    "netflix": "NFLX", "amd": "AMD", "intel": "INTC",
}
_STOPWORD_TICKERS = {
    "I", "A", "THE", "IS", "IT", "MY", "AND", "OR", "TO", "IN", "ON", "AT",
    "BE", "DO", "IF", "SO", "UP", "AM", "PE", "US", "CEO", "ETF", "AI",
}


class PlannerAgent:
    """Turns a free-text query into a schema-validated, executable TaskGraph."""

    def __init__(self, llm=None) -> None:
        self.llm = llm if llm is not None else get_llm()

    # ------------------------------------------------------------------
    def plan(self, query: str, default_horizon_days: int = 90,
             risk_hint: Optional[str] = None,
             use_cache: bool = True) -> TaskGraph:
        started = time.perf_counter()

        graph = self._plan_with_llm(query, risk_hint, use_cache)
        if graph is None:
            graph = self._plan_fallback(query, default_horizon_days, risk_hint)

        graph = self._enforce_invariants(graph)
        graph.raw_query = query
        graph.prompt_version = PLANNER_PROMPT_VERSION
        self.last_duration_ms = int((time.perf_counter() - started) * 1000)
        return graph

    # ------------------------------------------------------------------
    def _plan_with_llm(self, query: str, risk_hint: Optional[str],
                       use_cache: bool) -> Optional[TaskGraph]:
        user = query if not risk_hint else f"{query}\n\nStated risk profile: {risk_hint}"

        # Cache on the query text: two users asking the same thing get the
        # same plan for one call. In the forward test the daily query per
        # ticker is templated, so this is a ~100% hit rate after day one --
        # which is what keeps the Planner inside a 45-call daily budget.
        key = stable_key("plan", PLANNER_PROMPT_VERSION, query.strip().lower(),
                         risk_hint or "") if use_cache else None

        res = self.llm.complete_json(
            system=PLANNER_SYSTEM,
            user=user,
            schema=TASK_GRAPH_SCHEMA,
            schema_name="task_graph",
            category="planner",
            cache_key=key,
            # 1600 truncated real plans mid-JSON: a five-subtask graph with
            # self-contained questions runs past it, and the client then saw
            # an unterminated string and failed over. Sized for the worst
            # case rather than the typical one.
            max_tokens=3000,
        )
        if res is None:
            return None
        try:
            return self._to_graph(res.data, planned_by=res.model, cached=res.cached)
        except Exception:
            # Schema-valid but semantically unusable (bad enum, empty
            # question, zero subtasks). If it came from cache the entry is
            # poisoned: replaying it would fail identically every run and
            # pin us to the fallback forever, so drop it and retry once
            # against the model.
            if res.cached and key:
                self.llm.invalidate(key)
                retry = self.llm.complete_json(
                    system=PLANNER_SYSTEM, user=user, schema=TASK_GRAPH_SCHEMA,
                    schema_name="task_graph", category="planner",
                    cache_key=key, max_tokens=3000)
                if retry is not None:
                    try:
                        return self._to_graph(retry.data, planned_by=retry.model,
                                              cached=False)
                    except Exception:
                        self.llm.invalidate(key)
            # Fall through to the deterministic path rather than propagate --
            # a live forward test must not die here.
            return None

    def _to_graph(self, d: Dict[str, Any], planned_by: str, cached: bool) -> TaskGraph:
        intent = Intent(d["intent"])
        # A plan with no subtasks is valid only for DEFINE, which is terminal
        # by design. Anywhere else it is a truncated or malformed response,
        # and accepting it silently produced a one-agent pipeline that still
        # looked well-formed downstream. Raising here sends the caller to the
        # next model, then to the deterministic fallback.
        if intent is not Intent.DEFINE and not (d.get("subtasks") or []):
            raise ValueError(f"intent={intent.value} returned zero subtasks")

        subtasks: List[SubTask] = []
        for i, raw in enumerate(d.get("subtasks") or []):
            q = (raw.get("question") or "").strip()
            if not q:
                continue
            subtasks.append(SubTask(
                id=(raw.get("id") or f"s{i + 1}").strip(),
                agent=AgentName(raw["agent"]),
                question=q,
                priority=int(raw.get("priority", i + 1)),
                acceptance=(raw.get("acceptance") or "").strip() or None,
            ))
        return TaskGraph(
            intent=Intent(d["intent"]),
            tickers=list(d.get("tickers") or []),
            horizon_days=int(d.get("horizon_days") or 90),
            risk_posture=RiskPosture(d.get("risk_posture") or "medium"),
            subtasks=subtasks,
            planned_by=planned_by,
            cached=cached,
            rationale=(d.get("rationale") or "").strip(),
        )

    # ------------------------------------------------------------------
    def _plan_fallback(self, query: str, default_horizon_days: int,
                       risk_hint: Optional[str]) -> TaskGraph:
        """Degraded path. Labelled as such so it can be excluded from metrics.

        Makes no attempt at intent classification beyond the crudest signal:
        pretending otherwise is how the v1 planner came to look like it was
        reasoning. Defaults to `assess`, the broadest non-advice intent.
        """
        low = query.lower()
        intent = Intent.ADVICE if re.search(
            r"\bshould i\b|\bmy (position|shares|stake)\b|\bbuy\b|\bsell\b", low
        ) else Intent.ASSESS

        m = _HORIZON_RE.search(query)
        horizon = (int(m.group(1)) * _HORIZON_UNITS[m.group(2).lower()]
                   if m else default_horizon_days)

        tickers = [t for t in _TICKER_RE.findall(query) if t not in _STOPWORD_TICKERS]
        for name, sym in _NAME_TO_TICKER.items():
            if name in low and sym not in tickers:
                tickers.append(sym)

        posture = RiskPosture(risk_hint) if risk_hint in {"low", "medium", "high"} \
            else RiskPosture.MEDIUM

        tick = tickers[0] if tickers else "the security"
        subtasks = [
            SubTask(id=f"s{i + 1}", agent=AgentName(a),
                    question=f"Report {a} findings for {tick} over the next {horizon} days.",
                    priority=i + 1)
            for i, a in enumerate(DEFAULT_AGENTS.get(intent.value, ()))
        ]
        return TaskGraph(
            intent=intent, tickers=tickers, horizon_days=horizon,
            risk_posture=posture, subtasks=subtasks,
            planned_by="deterministic-fallback",
            rationale="LLM planning unavailable; deterministic defaults applied.",
        )

    # ------------------------------------------------------------------
    def _enforce_invariants(self, g: TaskGraph) -> TaskGraph:
        return enforce_invariants(g)


def enforce_invariants(g: TaskGraph) -> TaskGraph:
    """Post-conditions the model is asked for but not trusted on.

    Module-level so callers that assemble a TaskGraph by other means -- the
    forward test pins intent and horizon rather than inferring them -- can
    apply the same guarantees without reaching into the class.
    """
    if g.intent is Intent.DEFINE:
        g.subtasks = []
        return g

    if g.intent.value in CAPITAL_AT_RISK_INTENTS:
        if not any(st.agent is AgentName.RISK for st in g.subtasks):
            tick = g.tickers[0] if g.tickers else "the security"
            g.subtasks.append(SubTask(
                id=f"s{len(g.subtasks) + 1}",
                agent=AgentName.RISK,
                question=(f"Estimate downside risk for {tick} over the next "
                          f"{g.horizon_days} days: value at risk, plausible "
                          f"maximum drawdown, and a position size consistent "
                          f"with a {g.risk_posture.value} risk posture."),
                priority=max((st.priority for st in g.subtasks), default=0) + 1,
                acceptance="Must give a numeric VaR and a position size.",
            ))
    return g
