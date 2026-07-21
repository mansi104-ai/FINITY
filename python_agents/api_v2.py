"""v2 API -- the agentic pipeline and the forward-test record.

Two audiences, one router.

``/v2/ask`` serves the chat app: free text in, a decision plus the full agent
trace out. The trace is returned rather than hidden because the trace is the
product -- a recommendation nobody can interrogate is worth very little in a
domain where being wrong is expensive.

``/v2/forward`` and ``/v2/agents`` serve the research showcase, reading
straight from the sealed forward-test store. Those numbers are deliberately
not curated: whatever the run has produced is what the page shows, including
when it has produced nothing yet. A results page that only appears once the
results look good is not evidence of anything.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

_HERE = Path(__file__).resolve().parent
_FORWARD = _HERE.parent / "eval" / "forward"
for p in (str(_HERE), str(_FORWARD)):
    if p not in sys.path:
        sys.path.insert(0, p)

router = APIRouter(prefix="/v2", tags=["v2"])

_pipeline: Optional[Dict[str, Any]] = None


def _get_pipeline() -> Dict[str, Any]:
    """Build the pipeline once. FinBERT costs ~47s to load, so paying that on
    the first request is bad enough without paying it on every request."""
    global _pipeline
    if _pipeline is None:
        from prices import PriceFetcher
        from agents.planner_v2 import PlannerAgent
        from agents.optimizer import OptimizerAgent
        from agents.auditor import MemoryStore
        from orchestrator.adapters import build_default_adapters
        from orchestrator.router import Router

        fetcher = PriceFetcher()
        _pipeline = {
            "fetcher": fetcher,
            "planner": PlannerAgent(),
            "router": Router(build_default_adapters(fetcher)),
            "optimizer": OptimizerAgent(max_iterations=2, memory=MemoryStore()),
        }
    return _pipeline


# --------------------------------------------------------------------------

class AskRequest(BaseModel):
    query: str = Field(min_length=3, max_length=1000)
    risk_profile: Optional[str] = Field(default=None)


class AgentTrace(BaseModel):
    agent: str
    status: str
    confidence: float
    weight: Optional[float] = None          # share of evidence weight
    voting_weight: Optional[float] = None   # share of the directional vote
    votes_on_direction: bool = False
    summary: List[str] = []
    payload: Dict[str, Any] = {}
    as_of: Optional[str] = None
    duration_ms: int = 0


@router.post("/ask")
async def ask(req: AskRequest) -> Dict[str, Any]:
    """Free text in; decision plus the evidence behind it out."""
    from contracts import AgentName, Intent
    from orchestrator.fusion import fuse, volatility_regime

    t0 = time.perf_counter()
    p = _get_pipeline()

    graph = p["planner"].plan(req.query, risk_hint=req.risk_profile)

    # `define` is terminal by design: a textbook question needs no market
    # data, and dispatching five agents at it would spend budget to answer
    # something no price series bears on.
    if graph.intent is Intent.DEFINE:
        return {
            "intent": graph.intent.value,
            "terminal": True,
            "answer": ("This is a general finance concept rather than a question "
                       "about a specific security, so no market data was gathered."),
            "plan": {"rationale": graph.rationale, "planned_by": graph.planned_by},
            "agents": [], "decision": None,
            "duration_ms": int((time.perf_counter() - t0) * 1000),
            "disclaimer": DISCLAIMER,
        }

    results = p["router"].dispatch(graph)
    results, verdict = p["optimizer"].run(graph, results, router=p["router"])

    mkt = next((r for r in results
                if r.agent is AgentName.MARKET and r.usable), None)
    regime = volatility_regime(
        (mkt.payload or {}).get("volatility_annual_pct") if mkt else None)

    decision, fw = fuse(results, regime=regime,
                        risk_posture=graph.risk_posture.value)

    traces = [AgentTrace(
        agent=r.agent.value, status=r.status.value, confidence=round(r.confidence, 3),
        weight=fw.weights.get(r.agent.value),
        voting_weight=fw.voting_weights.get(r.agent.value),
        votes_on_direction=r.agent.value in fw.voting_weights,
        summary=r.reasoning[:3], payload=r.payload or {},
        as_of=r.as_of, duration_ms=r.duration_ms).model_dump() for r in results]

    return {
        "intent": graph.intent.value,
        "terminal": False,
        "tickers": graph.tickers,
        "horizon_days": graph.horizon_days,
        "risk_posture": graph.risk_posture.value,
        "plan": {
            "rationale": graph.rationale,
            "planned_by": graph.planned_by,
            "cached": graph.cached,
            "subtasks": [{"agent": s.agent.value, "question": s.question}
                         for s in graph.subtasks],
        },
        "agents": traces,
        "optimizer": {
            "sufficient": verdict.sufficient,
            "screen": verdict.screen_reason,
            "conflict": verdict.conflict,
            "assessment": verdict.assessment,
            "iterations": verdict.iterations,
            "used_llm": verdict.used_llm,
        },
        "decision": decision,
        "fusion": {"regime": regime, "weights": fw.weights,
                   "voting_weights": fw.voting_weights,
                   "components": fw.components, "explanation": fw.explanation},
        # Where a fuller view of this evidence lives in the existing app.
        "links": _links_for(graph.tickers),
        "duration_ms": int((time.perf_counter() - t0) * 1000),
        "disclaimer": DISCLAIMER,
    }


DISCLAIMER = ("FINDEC is decision support, not investment advice. "
              "Every figure shown is evidence for you to weigh, not a recommendation to act on.")


def _links_for(tickers: List[str]) -> List[Dict[str, str]]:
    if not tickers:
        return [{"label": "Screener", "href": "/screener"}]
    t = tickers[0]
    return [
        {"label": f"{t} market detail", "href": f"/markets?symbol={t}"},
        {"label": f"{t} news", "href": f"/news?symbol={t}"},
        {"label": f"{t} earnings", "href": f"/earnings?symbol={t}"},
        {"label": "Compare", "href": f"/compare?a={t}"},
    ]


# --------------------------------------------------------------------------
# Forward test (research showcase)
# --------------------------------------------------------------------------

def _store():
    from store import PredictionStore
    return PredictionStore()


@router.get("/forward")
async def forward_summary() -> Dict[str, Any]:
    """Live state of the sealed forward test, including its integrity check."""
    s = _store()
    summary = s.summary()
    verify = s.verify()
    preds = s.predictions()

    by_arm: Dict[str, Dict[str, Any]] = {}
    for r in preds:
        a = by_arm.setdefault(r["arm"], {"n": 0, "up": 0, "down": 0, "flat": 0,
                                         "degraded": 0, "conf": 0.0})
        a["n"] += 1
        a[r["direction"]] = a.get(r["direction"], 0) + 1
        a["degraded"] += int(bool(r.get("degraded")))
        a["conf"] += float(r.get("confidence") or 0)
    for a in by_arm.values():
        a["mean_confidence"] = round(a["conf"] / a["n"], 4) if a["n"] else None
        a.pop("conf")

    return {
        "summary": summary,
        "integrity": verify,
        "arms": by_arm,
        "universe": _universe_meta(),
        # Stated up front so the page cannot be read as claiming more than it has.
        "status_note": (
            "Predictions are sealed when made and scored only once their horizon "
            "has elapsed. Until outcomes accrue, no performance claim is possible "
            "and none is made here."
        ),
    }


def _universe_meta() -> Dict[str, Any]:
    try:
        import universe as U
        m = U.load_manifest()
        return {"hash": m["hash"], "frozen_on": m["frozen_on"],
                "n_tickers": m["n_tickers"], "n_sectors": m["n_sectors"],
                "selection_rule": m["selection_rule"]}
    except Exception:
        return {}


@router.get("/agents")
async def agent_scores() -> Dict[str, Any]:
    """Per-agent hit rates with Wilson intervals, or an honest empty state."""
    import agent_scores as A
    result, n = A.score(_store(), record_to_reliability=False)

    def decorate(block):
        out = {}
        for name, regimes in block.items():
            out[name] = {}
            for regime, v in regimes.items():
                lo, hi = A._wilson(v["correct"], v["n"])
                out[name][regime] = {
                    **v,
                    "ci95": [round(lo, 4), round(hi, 4)],
                    # The honest headline: at small n almost everything will
                    # straddle 0.5, and saying so is the point.
                    "distinguishable_from_chance": bool(lo > 0.5 or hi < 0.5),
                }
        return out

    return {
        "outcomes_scored": n,
        "agents": decorate(result["agents"]),
        "fused": decorate(result["fused"]),
        "note": ("A 95% interval spanning 0.5 means the agent is not yet "
                 "distinguishable from a coin flip. Early in a forward test "
                 "that is the expected state, not a finding."),
    }


@router.get("/budget")
async def budget() -> Dict[str, Any]:
    """LLM spend, which is itself a claim the showcase makes."""
    from services.llm import get_llm
    return get_llm().budget_report()
