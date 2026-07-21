"""JSON Schemas used to constrain language-model output.

These are passed to OpenRouter as ``response_format={"type":"json_schema"}``
so the decoder can only emit conforming tokens. That is not a stylistic
preference. In the free-tier probe, every model tested failed to produce the
required object when merely *asked* for JSON, and three of four succeeded
when the schema was enforced. Prompt-and-parse is the reason the previous
Planner kept silently falling back to regex.

Strict mode requires every property to appear in ``required`` and every
object to set ``additionalProperties: false``. Genuinely optional fields are
therefore typed as nullable rather than omitted.
"""

from __future__ import annotations

from typing import Any, Dict

from .types import AgentName, Intent, RiskPosture

# Bump whenever a prompt or schema changes -- cached plans key on this, so a
# stale cache cannot outlive the contract that produced it.
# v2.1: intent labels re-derived from observed distributions -- `explain_move`
# widened to `interpret` (the source category is "Explain OR Interpret"), and
# explicit discriminators added for define/background and retrieve/background,
# which were the dominant confusions at v2.0.
# v2.2: renamed two labels rather than adding more prose. `background` was read
# as "background knowledge" (i.e. exactly what `define` means) and `retrieve`
# named a system action instead of a user need, drawing the agent name
# `fundamentals` as an answer. Now `company_profile` and `data_point`.
# v2.3: added the static-vs-evaluative axis separating company_profile (what a
# company IS) from interpret (how it is PERFORMING) -- the last confusion at v2.2.
PLANNER_PROMPT_VERSION = "v2.3"
OPTIMIZER_PROMPT_VERSION = "v2.0"
AUDITOR_PROMPT_VERSION = "v2.0"

_INTENTS = [i.value for i in Intent]
_ROUTABLE = [
    AgentName.RESEARCHER.value,
    AgentName.MARKET.value,
    AgentName.ANALYST.value,
    AgentName.RISK.value,
    AgentName.FUNDAMENTALS.value,
]
_POSTURES = [r.value for r in RiskPosture]


def _obj(props: Dict[str, Any], required=None) -> Dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": props,
        "required": required if required is not None else list(props),
    }


# --------------------------------------------------------------------------
# Planner
# --------------------------------------------------------------------------

TASK_GRAPH_SCHEMA: Dict[str, Any] = _obj({
    "intent": {
        "type": "string",
        "enum": _INTENTS,
        # Definitions live here, not only in the system prompt. Bare enum
        # values gave boundary confusions -- the same unambiguous entry
        # question came back `explain_move` on one run and `exit_timing` on
        # the next -- because there was nothing to classify against.
        "description": (
            "Classify by PRIMARY intent; pick exactly one.\n"
            "- interpret: explain or INTERPRET financial/market data. Covers both "
            "'why did X move' and 'is this metric healthy'. The user wants meaning "
            "drawn from data, not the raw number. This is the largest category.\n"
            "- screen: find securities matching criteria; user names no ticker.\n"
            "- assess: overall standing view of a named security ('how is MSFT doing', "
            "'pros and cons of this investment').\n"
            "- advice: recommend an action on the USER'S OWN position (buy/sell/add/trim/hold).\n"
            "- risk_check: downside, exposure or sizing for a position.\n"
            "- company_profile: what a SPECIFIC COMPANY IS or DOES -- business model, "
            "strategy, segments, where revenue comes from. STATIC and structural. "
            "Never an evaluation of how well it is doing.\n"
            "- summarize: condense a NAMED document or period (earnings call, recent headlines).\n"
            "- data_point: one specific NUMBER about a company. The answer is a figure.\n"
            "- trend: direction of a metric over a stated window.\n"
            "- compare: rank or contrast securities the user has named.\n"
            "- define: a GENERAL finance concept or mechanic, true of markets at large, "
            "with NO specific company in scope. Textbook knowledge.\n"
            "Boundaries that are easy to get wrong -- work through these:\n"
            "- define vs company_profile: is a specific COMPANY in scope? 'What does "
            "high liquidity mean', 'coupon vs yield', 'what happens when a stock "
            "splits' = define -- all true of markets generally, no company involved. "
            "'What does this company do', 'what is their AI strategy' = "
            "company_profile. Note define questions may still say 'my position' -- "
            "that does not make them company-specific.\n"
            "- data_point vs company_profile: is the answer a NUMBER? 'What is the "
            "P/E', 'how many vehicles did they deliver last quarter', 'what was gaming "
            "revenue in 2023' = data_point. 'What's their AI strategy' = "
            "company_profile.\n"
            "- data_point vs trend: one figure at one time = data_point; a direction "
            "over a window = trend.\n"
            "- interpret vs company_profile: the axis is STATIC vs EVALUATIVE. "
            "company_profile = what the company IS ('what does this company do', "
            "'what is their AI strategy', 'where does revenue come from'). "
            "interpret = how something is PERFORMING or WHY it moved ('how healthy "
            "are their margins', 'how is their battery business performing', 'why is "
            "the stock up'). If the question asks you to JUDGE rather than DESCRIBE, "
            "it is interpret.\n"
            "- interpret vs data_point: 'how healthy are their margins' = interpret "
            "(wants a judgement); 'what is their margin' = data_point (wants the figure).\n"
            "- interpret vs assess: interpret is about a specific datum or move; "
            "assess is an overall view of the whole security.\n"
            "- advice vs assess: advice involves the user's own money or position "
            "('my position', 'should I'). assess merely describes the security.\n"
            "- advice vs risk_check: advice asks what to DO; risk_check asks HOW MUCH "
            "could be lost.\n"
            "- interpret vs trend: interpret asks WHY or SO WHAT; trend asks WHAT "
            "HAPPENED over a window.\n"
            "- screen vs compare: screen searches an open universe; compare ranks a "
            "set the user already named."
        ),
    },
    "tickers": {
        "type": "array",
        "items": {"type": "string"},
        "description": (
            "Resolved uppercase exchange symbols. Map company names to "
            "symbols (e.g. 'Nvidia' -> 'NVDA'). Empty only for a screen."
        ),
    },
    "horizon_days": {
        "type": "integer",
        "description": (
            "Decision horizon in calendar days, resolved from relative "
            "phrasing ('three weeks' -> 21). Default 90 if unstated."
        ),
    },
    "risk_posture": {
        "type": "string",
        "enum": _POSTURES,
        "description": (
            "Inferred loss tolerance. Read the user's own language about "
            "drawdown, not just an explicit label."
        ),
    },
    "rationale": {
        "type": "string",
        "description": "One sentence: why this decomposition fits the query.",
    },
    "subtasks": {
        "type": "array",
        "description": (
            "Only the agents this query genuinely needs. Do not pad with "
            "every agent -- an unnecessary subtask costs latency and budget."
        ),
        "items": _obj({
            "id": {"type": "string", "description": "Short unique slug, e.g. 's1'."},
            "agent": {"type": "string", "enum": _ROUTABLE},
            "question": {
                "type": "string",
                "description": (
                    "Self-contained instruction. The agent never sees the "
                    "user's original query, so restate every needed detail."
                ),
            },
            "priority": {"type": "integer", "description": "1 = highest."},
            "acceptance": {
                "type": "string",
                "description": "What a usable answer must contain.",
            },
        }),
    },
}, required=["intent", "tickers", "horizon_days", "risk_posture", "rationale", "subtasks"])


PLANNER_SYSTEM = """\
You are the Planner Agent of FINDEC, a financial decision-support system.

Decompose the user's query into an executable task graph. You are planning \
work, not answering the question -- never state a view on the security.

Rules:
- Resolve company names to exchange symbols ("Nvidia" -> "NVDA").
- Resolve relative timeframes to a day count ("three weeks" -> 21). If the \
query states no timeframe, use 90.
- Infer risk posture from how the user talks about loss, not only from \
explicit labels. "I can't stomach a big drawdown" is low posture even \
alongside an aggressive position.
- Emit a subtask only where that agent's evidence would change the answer. \
Fewer, sharper subtasks beat exhaustive ones.
- Each subtask question must stand alone: the receiving agent sees only that \
string and its params, never the original query. Restate the ticker and the \
horizon inside every question.
- intent `define` is terminal: emit an empty subtask list.
- intent `advice` or `risk_check` must always include a `risk` subtask, \
whether or not the user asked about downside.

Agents available:
- researcher     news and sentiment
- market         price action, volatility, technical levels
- analyst        directional forecast over the horizon
- risk           VaR, drawdown, position sizing
- fundamentals   earnings, valuation, company financials

Worked examples of the intent boundaries that matter most:

  "Should I add to my Apple position? Six months out, I'm aggressive."
    -> advice        (the user's own position + an action) NOT assess,
                     NOT interpret. AAPL, 180 days, high posture.

  "How's MSFT been doing?"
    -> assess        (standing view, no position, no action) NOT advice.

  "Why is ASML up so much today?"
    -> interpret     (asks WHY about a specific datum) NOT trend.

  "How has TIC performed over the last six months?"
    -> trend         (asks WHAT HAPPENED over a window) NOT interpret.

  "I'm up 40% on Nvidia and nervous about earnings. Take some off?"
    -> advice        (action on own position) NOT risk_check, though the
                     low posture and the mandatory risk subtask both follow.

  "What's my downside if I hold 200 shares of TSLA through earnings?"
    -> risk_check    (asks HOW MUCH could be lost) NOT advice.

  "Show me stocks at 52-week highs"
    -> screen        (open universe, no ticker named) NOT compare.

  "What does high liquidity mean?"
    -> define        (a market-wide concept; no company in scope)
                     NOT company_profile.

  "If a stock splits, what happens to my position?"
    -> define        (a general market mechanic). "my position" refers to the
                     user's holding but names no company, so this stays define.

  "What is the P/E ratio?"
    -> data_point    (the answer is a number) NOT company_profile.

  "What's their AI strategy?"
    -> company_profile (qualitative, about one company) NOT define.
"""


# --------------------------------------------------------------------------
# Optimizer
# --------------------------------------------------------------------------

OPTIMIZER_VERDICT_SCHEMA: Dict[str, Any] = _obj({
    "sufficient": {
        "type": "boolean",
        "description": (
            "True if the evidence already supports a decision. Answer true "
            "when the picture is clear -- re-querying a settled question "
            "wastes budget."
        ),
    },
    "conflict": {
        "type": "string",
        "description": (
            "The substantive disagreement between agents, or empty if none. "
            "Two agents merely being uncertain is not a conflict; they must "
            "point in opposing directions."
        ),
    },
    "requeries": {
        "type": "array",
        "description": (
            "Agents to re-run, with a sharpened question. Empty when "
            "sufficient is true. Never re-query an agent that returned "
            "unavailable -- the data source is down, not the question wrong."
        ),
        "items": _obj({
            "subtask_id": {"type": "string"},
            "agent": {"type": "string", "enum": _ROUTABLE},
            "revised_question": {
                "type": "string",
                "description": "Sharpened question addressing why the first answer fell short.",
            },
            "reason": {"type": "string"},
        }),
    },
    "assessment": {
        "type": "string",
        "description": "Two sentences on what the evidence collectively shows.",
    },
}, required=["sufficient", "conflict", "requeries", "assessment"])


OPTIMIZER_SYSTEM = """\
You are the Optimizer Agent of FINDEC. You receive the outputs of several \
specialist agents and decide whether they are collectively sufficient to \
support a decision.

You do not make the decision and you do not produce numbers. Numeric \
synthesis is handled by a calibrated weighting function downstream; your job \
is to judge evidential sufficiency and, where it is lacking, to say exactly \
which agent should be asked what.

Judgement rules:
- Default to sufficient. Re-querying is expensive and most queries are clear.
- Re-query only for a resolvable defect: a question that missed its target, \
an answer that ignored its acceptance criteria, or a genuine contradiction.
- Low confidence alone is not grounds to re-query. An agent that is honestly \
uncertain about an uncertain thing has done its job.
- Never re-query an agent whose status was unavailable or no_data.
"""


# --------------------------------------------------------------------------
# Auditor
# --------------------------------------------------------------------------

AUDIT_SCHEMA: Dict[str, Any] = _obj({
    "decisions": {
        "type": "array",
        "items": _obj({
            "decision_id": {"type": "string"},
            "sound": {
                "type": "boolean",
                "description": "Does the stated rationale actually follow from the evidence?",
            },
            "issue": {
                "type": "string",
                "description": "The specific defect, or empty if sound.",
            },
        }),
    },
    "lessons": {
        "type": "array",
        "description": (
            "Durable, transferable observations worth carrying into future "
            "decisions. Must be falsifiable and not restate a single day's "
            "outcome. Empty is a valid and common answer."
        ),
        "items": _obj({
            "claim": {"type": "string"},
            "scope": {
                "type": "string",
                "description": "Where it applies: a ticker, a sector, a volatility regime, or 'global'.",
            },
            "evidence_decision_ids": {"type": "array", "items": {"type": "string"}},
        }),
    },
}, required=["decisions", "lessons"])


AUDITOR_SYSTEM = """\
You are the Auditor Agent of FINDEC. You review completed decision traces \
after the fact.

You are checking reasoning, not outcomes. A decision that was well-reasoned \
and lost money is sound; one that was ill-reasoned and made money is not. \
You will often be shown traces whose outcomes are not yet known, which is \
deliberate -- judging process independently of result is the point.

Record a lesson only when it is durable and falsifiable. "NVDA fell on \
Tuesday" is not a lesson. "Sentiment leads price by roughly a day for this \
name in high-volatility regimes" is, provided the traces support it.
"""
