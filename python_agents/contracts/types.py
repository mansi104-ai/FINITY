"""Data contracts exchanged between FINDEC agents.

Everything in this module is deliberately explicit about two things, because
they are what make the system defensible rather than merely plausible:

1. **Two separate notions of uncertainty.** An agent's self-reported
   ``confidence`` is cheap and frequently miscalibrated -- a language model
   asked "how sure are you?" will happily say 0.9 about a coin flip. Measured
   ``reliability`` is the agent's realised hit rate in the *current* market
   regime, earned from logged outcomes. Fusion weights are a function of
   both. Keeping them in separate fields is what stops a confident agent
   from outvoting an accurate one.

2. **Point-in-time provenance.** Every result records the newest data it was
   permitted to see (``as_of``) and the window it drew from. A decision can
   therefore be re-derived exactly, and any leak of future information into
   a past decision is detectable by comparing ``as_of`` against the decision
   date rather than by trusting that the pipeline behaved.

These are the fields an evaluator needs. They are not bookkeeping.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional


# --------------------------------------------------------------------------
# Enumerations
# --------------------------------------------------------------------------

class Intent(str, Enum):
    """What the user is actually trying to decide.

    Grounded in observed query distributions rather than invented -- see
    docs/QUERY_TAXONOMY.md. The earlier invented labels produced boundary
    confusions (the same unambiguous entry question classified
    `explain_move` on one run and `exit_timing` on the next), because the
    schema offered bare enum values with nothing to classify against.

    Shares below are from Blankespoor et al.'s 29,242 retail questions and
    are indicative of relative frequency, not targets.

    Changing a label here invalidates cached plans; bump
    PLANNER_PROMPT_VERSION when it happens.
    """

    INTERPRET = "interpret"         # ~47% of observed volume
    SCREEN = "screen"               # ~28%
    ASSESS = "assess"               # ~9%
    ADVICE = "advice"               # excluded from the source sample; FINDEC's core case
    RISK_CHECK = "risk_check"
    COMPANY_PROFILE = "company_profile"
    SUMMARIZE = "summarize"
    DATA_POINT = "data_point"
    TREND = "trend"
    COMPARE = "compare"
    DEFINE = "define"               # terminal: answered without dispatching agents


class AgentName(str, Enum):
    """Agents that a subtask can be routed to.

    Split by *plane*, which is the load-bearing architectural distinction:

    - Control plane (PLANNER, OPTIMIZER, AUDITOR, CURATOR) decides what work
      to do. Language-model driven. Not backtestable, because a model that
      has read the future cannot be asked to plan against the past.
    - Decision plane (RESEARCHER, MARKET, ANALYST, RISK, FUNDAMENTALS)
      decides what the market will do. Numerical and deterministic given its
      inputs, therefore backtestable without contamination.
    """

    # Control plane
    PLANNER = "planner"
    OPTIMIZER = "optimizer"
    AUDITOR = "auditor"
    CURATOR = "curator"
    # Decision plane
    RESEARCHER = "researcher"
    MARKET = "market"
    ANALYST = "analyst"
    RISK = "risk"
    FUNDAMENTALS = "fundamentals"


CONTROL_PLANE = frozenset({
    AgentName.PLANNER, AgentName.OPTIMIZER, AgentName.AUDITOR, AgentName.CURATOR,
})
DECISION_PLANE = frozenset({
    AgentName.RESEARCHER, AgentName.MARKET, AgentName.ANALYST,
    AgentName.RISK, AgentName.FUNDAMENTALS,
})


# Routing prior: the agents an intent normally needs. The Planner may add or
# drop subtasks when a query warrants it -- this is a default, not a fixed
# schedule -- but two rules are enforced downstream regardless:
#   * DEFINE dispatches nothing; sending a definition to five agents spends
#     budget on a question no market data bears on.
#   * ADVICE and RISK_CHECK always dispatch RISK, asked for or not, because
#     both put the user's own capital in scope.
# Derived from the intent/agent mapping in docs/QUERY_TAXONOMY.md.
DEFAULT_AGENTS: Dict[str, tuple] = {
    "interpret": ("market", "researcher"),
    "screen": ("market", "fundamentals"),
    "assess": ("market", "analyst", "researcher", "fundamentals"),
    "advice": ("market", "analyst", "risk", "researcher"),
    "risk_check": ("risk", "market", "analyst"),
    "company_profile": ("fundamentals",),
    "summarize": ("researcher", "fundamentals"),
    "data_point": ("fundamentals", "market"),
    "trend": ("market", "fundamentals"),
    "compare": ("market", "fundamentals", "analyst"),
    "define": (),
}

# Intents that put the user's own capital at stake; a downside estimate is
# attached to these whether or not the query asked for one.
CAPITAL_AT_RISK_INTENTS = frozenset({"advice", "risk_check"})


class ResultStatus(str, Enum):
    OK = "ok"
    NO_DATA = "no_data"          # source reachable, nothing to report
    UNAVAILABLE = "unavailable"  # source unreachable; distinct from NO_DATA
    REFUSED = "refused"          # agent declined (out of scope / unsafe)
    ERROR = "error"


class RiskPosture(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


# --------------------------------------------------------------------------
# Task decomposition
# --------------------------------------------------------------------------

@dataclass
class SubTask:
    """One unit of work, addressed to exactly one agent.

    ``question`` must be self-contained. The receiving agent never sees the
    original user query, which is deliberate: it forces the Planner to do
    real decomposition instead of broadcasting the raw text and letting each
    agent re-interpret it. It also means a subtask can be cached, replayed
    and diffed on its own.
    """

    id: str
    agent: AgentName
    question: str
    priority: int = 1
    # Free-form structured hints (ticker, lookback, thresholds). Kept
    # separate from `question` so numeric agents never parse prose.
    params: Dict[str, Any] = field(default_factory=dict)
    # What a usable answer looks like; the Optimizer tests against this to
    # decide whether a re-query is warranted.
    acceptance: Optional[str] = None
    depends_on: List[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if isinstance(self.agent, str):
            self.agent = AgentName(self.agent)
        if not self.question or not self.question.strip():
            raise ValueError(f"SubTask {self.id}: question must be non-empty")


@dataclass
class TaskGraph:
    """The Planner's output: what the user wants, decomposed into subtasks.

    Unlike the v1 planner -- which emitted a `needs` dict that the
    orchestrator then ignored -- this structure *is* the execution plan. The
    router dispatches exactly ``subtasks`` and nothing else, so a plan that
    omits an agent genuinely skips it.
    """

    intent: Intent
    tickers: List[str]
    horizon_days: int
    risk_posture: RiskPosture
    subtasks: List[SubTask]
    raw_query: str = ""
    # Provenance -- which model produced this plan, and was it a cache hit.
    planned_by: str = "unknown"
    prompt_version: str = "v0"
    cached: bool = False
    rationale: str = ""

    def __post_init__(self) -> None:
        if isinstance(self.intent, str):
            self.intent = Intent(self.intent)
        if isinstance(self.risk_posture, str):
            self.risk_posture = RiskPosture(self.risk_posture)
        self.tickers = [t.strip().upper() for t in self.tickers if t and t.strip()]
        if self.horizon_days <= 0:
            raise ValueError(f"horizon_days must be positive, got {self.horizon_days}")
        seen = set()
        for st in self.subtasks:
            if st.id in seen:
                raise ValueError(f"duplicate subtask id {st.id!r}")
            seen.add(st.id)
        for st in self.subtasks:
            for dep in st.depends_on:
                if dep not in seen:
                    raise ValueError(f"subtask {st.id!r} depends on unknown {dep!r}")

    def agents_used(self) -> List[AgentName]:
        return sorted({st.agent for st in self.subtasks}, key=lambda a: a.value)

    def cache_key(self) -> str:
        """Signature for plan reuse.

        Keys on the *shape* of the request, never on the date or the ticker's
        current price. Two structurally identical questions asked six weeks
        apart should reuse one plan -- that reuse is what keeps the Planner
        inside a 50-call/day budget across a 50-ticker forward test.
        """
        payload = json.dumps(
            {
                "intent": self.intent.value,
                "n_tickers": len(self.tickers),
                "horizon_days": self.horizon_days,
                "risk": self.risk_posture.value,
                "prompt_version": self.prompt_version,
            },
            sort_keys=True,
        )
        return hashlib.sha256(payload.encode()).hexdigest()[:16]


# --------------------------------------------------------------------------
# Evidence and agent results
# --------------------------------------------------------------------------

@dataclass
class Evidence:
    """A single citable item backing an agent's claim.

    ``published_at`` drives recency weighting and is also the lookahead
    tripwire: evidence published after a decision's ``as_of`` must never
    appear in that decision.
    """

    source: str
    title: str = ""
    url: str = ""
    published_at: Optional[str] = None   # ISO-8601 UTC
    snippet: str = ""
    weight: float = 1.0


@dataclass
class AgentResult:
    """What an agent returns for one subtask.

    ``confidence`` is self-reported and NOT to be trusted on its own -- see
    the module docstring. It is an input to weighting, never the weight.
    """

    subtask_id: str
    agent: AgentName
    status: ResultStatus
    payload: Dict[str, Any] = field(default_factory=dict)
    confidence: float = 0.5
    evidence: List[Evidence] = field(default_factory=list)
    reasoning: List[str] = field(default_factory=list)

    # ---- point-in-time provenance -------------------------------------
    # Newest datum this result was permitted to observe. The forward-test
    # sealer rejects any result whose as_of postdates the decision date.
    as_of: Optional[str] = None
    data_window_start: Optional[str] = None
    data_window_end: Optional[str] = None
    # Age, in hours, of the freshest input. Drives live-vs-historical
    # weighting: a quote from an open market outweighs an overnight cache.
    staleness_hours: Optional[float] = None
    is_live: bool = False

    # ---- accounting ----------------------------------------------------
    duration_ms: int = 0
    llm_calls: int = 0
    llm_tokens: int = 0
    model: Optional[str] = None
    cached: bool = False
    iteration: int = 0   # bumped when the Optimizer re-queries

    def __post_init__(self) -> None:
        if isinstance(self.agent, str):
            self.agent = AgentName(self.agent)
        if isinstance(self.status, str):
            self.status = ResultStatus(self.status)
        self.confidence = float(min(1.0, max(0.0, self.confidence)))

    @property
    def usable(self) -> bool:
        return self.status is ResultStatus.OK


# --------------------------------------------------------------------------
# Fusion
# --------------------------------------------------------------------------

@dataclass
class FusionWeights:
    """The weight each agent's output carried, and why.

    Recorded rather than recomputed. A reviewer asking "why did sentiment
    dominate here?" gets an answer from the logged decision instead of a
    re-run, and the components are stored separately so the contribution of
    each factor is inspectable.
    """

    # Share of total evidence weight. Includes agents that inform sizing but
    # cast no directional vote (risk, fundamentals).
    weights: Dict[str, float] = field(default_factory=dict)
    # Share of the *directional* vote, renormalised over agents that actually
    # express a direction. Reported separately because the two differ a lot:
    # risk routinely carries the largest evidence weight while contributing
    # nothing to the call, and showing one number invites the reader to
    # assume it drove the other.
    voting_weights: Dict[str, float] = field(default_factory=dict)
    # Per-agent factor breakdown: agent -> {confidence, reliability,
    # freshness, regime_fit}. Their product (normalised) gives `weights`.
    components: Dict[str, Dict[str, float]] = field(default_factory=dict)
    regime: str = "unknown"
    explanation: str = ""


@dataclass
class Decision:
    """A sealed, auditable record of one end-to-end run.

    This is the unit the forward test logs. Once written it is never
    mutated; the realised outcome is attached later by ticker+date join, so
    the prediction cannot be edited after the fact.
    """

    decision_id: str
    created_at: str
    as_of: str                  # data cutoff -- nothing newer informed this
    arm: str                    # "A" numerical-only | "B" full agentic
    ticker: str
    intent: Intent
    horizon_days: int

    action: str                 # buy | sell | hold
    position_pct: float
    confidence: float

    task_graph: Optional[TaskGraph] = None
    results: List[AgentResult] = field(default_factory=list)
    fusion: Optional[FusionWeights] = None
    optimizer_iterations: int = 0
    rationale: str = ""

    pipeline_version: str = "v2"
    total_llm_calls: int = 0
    total_llm_tokens: int = 0
    total_duration_ms: int = 0

    def to_json(self) -> str:
        return json.dumps(asdict(self), default=_enum_default, sort_keys=True)

    def seal(self) -> str:
        """Content hash, so tampering with a logged prediction is detectable."""
        return hashlib.sha256(self.to_json().encode()).hexdigest()


def _enum_default(o: Any) -> Any:
    if isinstance(o, Enum):
        return o.value
    raise TypeError(f"not JSON serialisable: {type(o)}")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()
