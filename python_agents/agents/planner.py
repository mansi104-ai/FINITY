"""Planner Agent (FINDEC v1).

Turns a free-text user query + request fields into a structured investment
task, and decides which downstream agents/evidence sources are actually
needed to answer it. This is the "brain" described in the FINDEC v1 design:
it does not itself do research, prediction, or risk math — it produces a
plan that the orchestrator (crew.py) executes.

Deliberately deterministic (regex/keyword based) for v1. No LLM call.
"""

import re
import time
from typing import Dict, List, Optional, Tuple

try:
    from ..services.llm_client import get_llm_client
except Exception:
    try:
        from services.llm_client import get_llm_client
    except ModuleNotFoundError:
        from python_agents.services.llm_client import get_llm_client

HORIZON_PATTERNS = [
    (re.compile(r"(\d+)\s*(day|days)\b", re.IGNORECASE), "days"),
    (re.compile(r"(\d+)\s*(week|weeks|wk|wks)\b", re.IGNORECASE), "weeks"),
    (re.compile(r"(\d+)\s*(month|months|mo|mos)\b", re.IGNORECASE), "months"),
    (re.compile(r"(\d+)\s*(year|years|yr|yrs)\b", re.IGNORECASE), "years"),
]

HORIZON_UNIT_TO_DAYS = {"days": 1, "weeks": 7, "months": 30, "years": 365}

# Default horizon when the query gives no explicit timeframe.
DEFAULT_HORIZON_LABEL = "3 months"
DEFAULT_HORIZON_DAYS = 90

GOAL_KEYWORDS = {
    "investment": ["invest", "buy", "long term", "hold", "accumulate"],
    "trade": ["trade", "swing", "day trade", "scalp", "short term", "flip"],
    "exit": ["sell", "exit", "unload", "dump", "liquidate"],
}

RISK_PROFILE_ALIASES = {
    "conservative": "low",
    "cautious": "low",
    "low": "low",
    "moderate": "medium",
    "medium": "medium",
    "balanced": "medium",
    "aggressive": "high",
    "high": "high",
}

OBJECTIVE_BY_RISK = {
    "low": "capital_preservation",
    "medium": "balanced",
    "high": "growth",
}

# Keywords that signal the user explicitly wants (or does not care about)
# a given evidence source. v1 defaults to needing all three; a query can
# only add emphasis, not remove a source, since removing evidence sources
# silently would change what the recommendation is based on.
RISK_EMPHASIS_KEYWORDS = ["risk", "safe", "volatil", "downside", "drawdown", "var"]
NEWS_EMPHASIS_KEYWORDS = ["news", "sentiment", "headline", "announc", "earnings"]
MARKET_EMPHASIS_KEYWORDS = ["price", "chart", "technical", "trend", "momentum"]


PLANNER_SYSTEM_PROMPT = """You are the Planner Agent in a financial decision system. \
Given a user's investment query, extract a structured task. Respond with ONLY a JSON \
object, no prose, no markdown fences, matching exactly this schema:
{
  "goal": "investment" | "trade" | "exit",
  "horizon_label": "<human readable timeframe, e.g. '6 months'>",
  "horizon_days": <integer>,
  "objective": "capital_preservation" | "balanced" | "growth",
  "needs_research": true | false,
  "needs_market": true | false,
  "needs_risk": true | false
}
If the query gives no explicit timeframe, use a sensible default around 90 days. \
needs_research/needs_market/needs_risk should be true unless the query clearly makes \
one of them irrelevant -- default all three to true when unsure."""


class PlannerAgent:
    """Parses the raw request into a structured task + execution plan."""

    def __init__(self) -> None:
        self.llm = get_llm_client()

    def plan(self, query: str, ticker: str, budget: float, risk_profile: str) -> dict:
        start = time.perf_counter()
        reasoning: List[str] = []

        normalized_risk = RISK_PROFILE_ALIASES.get(str(risk_profile).lower(), "medium")
        if normalized_risk != str(risk_profile).lower():
            reasoning.append(f"Normalized risk profile '{risk_profile}' -> '{normalized_risk}'.")

        llm_plan = self._plan_with_llm(query=query, risk=normalized_risk)
        used_llm = llm_plan is not None

        if used_llm:
            goal = llm_plan["goal"]
            horizon_label = llm_plan["horizon_label"]
            horizon_days = llm_plan["horizon_days"]
            objective = llm_plan["objective"]
            needs = {
                "research": llm_plan["needs_research"],
                "market": llm_plan["needs_market"],
                "risk": llm_plan["needs_risk"],
                "_emphasis": {},
            }
            reasoning.append("Planned via Claude-assisted extraction.")
        else:
            horizon_label, horizon_days = self._extract_horizon(query)
            reasoning.append(f"Parsed investment horizon as {horizon_label} ({horizon_days} days).")

            goal = self._extract_goal(query)
            reasoning.append(f"Classified goal as '{goal}' from query wording.")

            objective = OBJECTIVE_BY_RISK.get(normalized_risk, "balanced")
            reasoning.append(f"Objective set to '{objective}' based on risk profile.")

            needs = self._determine_needs(query, goal)
            reasoning.append(
                "Evidence sources required: "
                + ", ".join(k for k, v in needs.items() if v and not k.startswith("_"))
            )
            if not self.llm.available:
                reasoning.append("ANTHROPIC_API_KEY not set; used deterministic regex/keyword planning.")
            else:
                reasoning.append("LLM planning call failed or returned invalid data; used deterministic fallback.")

        task = {
            "ticker": ticker.upper(),
            "goal": goal,
            "horizon": horizon_label,
            "horizonDays": horizon_days,
            "budget": round(float(budget), 2),
            "risk": normalized_risk,
            "objective": objective,
        }

        return {
            "task": task,
            "needs": needs,
            "reasoning": reasoning,
            "plannedBy": "llm" if used_llm else "deterministic",
            "message": f"Planned {goal} task for {task['ticker']} over {horizon_label}.",
            "durationMs": int((time.perf_counter() - start) * 1000),
        }

    def _plan_with_llm(self, query: str, risk: str) -> Optional[dict]:
        if not self.llm.available:
            return None
        user_prompt = f"Query: {query}\nRisk profile: {risk}"
        result = self.llm.complete_json(system=PLANNER_SYSTEM_PROMPT, user=user_prompt, max_tokens=300)
        if not result:
            return None

        required_keys = {
            "goal", "horizon_label", "horizon_days", "objective",
            "needs_research", "needs_market", "needs_risk",
        }
        if not required_keys.issubset(result.keys()):
            return None
        if result["goal"] not in {"investment", "trade", "exit"}:
            return None
        if result["objective"] not in {"capital_preservation", "balanced", "growth"}:
            return None
        try:
            result["horizon_days"] = int(result["horizon_days"])
        except (TypeError, ValueError):
            return None
        return result

    def _extract_horizon(self, query: str) -> Tuple[str, int]:
        for pattern, unit in HORIZON_PATTERNS:
            match = pattern.search(query)
            if match:
                amount = int(match.group(1))
                days = amount * HORIZON_UNIT_TO_DAYS[unit]
                label = f"{amount} {unit}" if amount != 1 else f"{amount} {unit[:-1]}"
                return label, days
        return DEFAULT_HORIZON_LABEL, DEFAULT_HORIZON_DAYS

    def _extract_goal(self, query: str) -> str:
        lowered = query.lower()
        for goal, keywords in GOAL_KEYWORDS.items():
            if any(keyword in lowered for keyword in keywords):
                return goal
        return "investment"

    def _determine_needs(self, query: str, goal: str) -> Dict[str, bool]:
        lowered = query.lower()
        needs = {"research": True, "market": True, "risk": True}
        # v1 keeps all three sources on by default (per design: correctness
        # over minimalism). Emphasis keywords are recorded for the
        # orchestrator/UI but do not disable a source.
        needs["_emphasis"] = {
            "research": any(k in lowered for k in NEWS_EMPHASIS_KEYWORDS),
            "market": any(k in lowered for k in MARKET_EMPHASIS_KEYWORDS),
            "risk": any(k in lowered for k in RISK_EMPHASIS_KEYWORDS) or goal == "exit",
        }
        return needs