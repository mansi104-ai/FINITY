"""Dynamic fusion -- combines agent results into one decision.

Static weights are useless in practice: an agent that is informative in a
quiet tape is not equally informative in a volatile one, and a sentiment
reading from stale news should not carry the same force as one from this
morning. So no weight here is a constant.

Every weight is a **function of observable state**:

    weight_i  proportional to  confidence_i^a * reliability_i^b * freshness_i^c

* ``confidence`` -- the agent's own, from evidence it can point at (sample
  size, indicator agreement, dispersion across headlines).
* ``reliability`` -- its *measured* hit rate in the prevailing volatility
  regime, earned from logged outcomes. This is what stops a confident agent
  outvoting an accurate one.
* ``freshness`` -- decay in the age of the newest input, scaled by whether
  the market is currently open. A quote during a live session is worth more
  than an overnight cache; a five-year history is worth something, but not
  the same something.

The deliberate exclusion is a language model emitting a weight. That number
would be unbacktestable (the model has read the future), unstable across
runs, and unauditable. A weight derived from measurable state is all three of
the opposites, and adapts just as much.

Every component is recorded in ``FusionWeights.components`` so any decision
can be re-derived and questioned after the fact.
"""

from __future__ import annotations

import math
from datetime import datetime, time as dtime, timezone
from typing import Dict, List, Optional, Tuple

try:
    from ..contracts import AgentName, AgentResult, FusionWeights, ResultStatus
except ImportError:
    from contracts import AgentName, AgentResult, FusionWeights, ResultStatus  # type: ignore


# Exponents. confidence and reliability matter most; freshness modulates.
ALPHA_CONFIDENCE = 1.0
BETA_RELIABILITY = 1.5     # measured track record outranks self-report
GAMMA_FRESHNESS = 0.5

# Sentiment decays fastest, risk statistics slowest: a VaR built on two years
# of returns does not become wrong overnight, whereas a news reading does.
HALF_LIFE_HOURS: Dict[str, float] = {
    "researcher": 18.0,
    "market": 36.0,
    "analyst": 48.0,
    "fundamentals": 720.0,
    "risk": 2160.0,
}

# Prior when an agent has no logged outcomes yet. Deliberately mid-scale:
# a new agent is neither trusted nor dismissed.
RELIABILITY_PRIOR = 0.5


def market_open_now(now: Optional[datetime] = None) -> bool:
    """True during US regular equity hours, approximately.

    Weekday 13:30-20:00 UTC (09:30-16:00 America/New_York during EDT). No
    holiday calendar and no DST handling -- this scales a weight, it does not
    gate a trade, so an hour's error at a DST boundary is immaterial.
    """
    now = now or datetime.now(timezone.utc)
    if now.weekday() >= 5:
        return False
    return dtime(13, 30) <= now.time() <= dtime(20, 0)


def volatility_regime(annual_vol_pct: Optional[float]) -> str:
    """Bucket used to condition reliability. Agents are not equally good in
    every tape, so a track record must be regime-specific to mean anything."""
    if annual_vol_pct is None:
        return "unknown"
    if annual_vol_pct < 20.0:
        return "low_vol"
    if annual_vol_pct < 40.0:
        return "mid_vol"
    return "high_vol"


def freshness_score(result: AgentResult, now: Optional[datetime] = None) -> float:
    """Exponential decay in the age of the newest input, in [0.2, 1.0].

    Floored rather than allowed to reach zero: stale evidence is weaker
    evidence, not an absence of evidence, and zeroing it would silently drop
    an agent from the vote instead of down-weighting it.
    """
    now = now or datetime.now(timezone.utc)
    hl = HALF_LIFE_HOURS.get(result.agent.value, 48.0)

    age_h = result.staleness_hours
    if age_h is None and result.as_of:
        try:
            d = datetime.fromisoformat(result.as_of.replace("Z", "+00:00"))
            if d.tzinfo is None:
                d = d.replace(tzinfo=timezone.utc)
            age_h = max(0.0, (now - d).total_seconds() / 3600.0)
        except Exception:
            age_h = None
    if age_h is None:
        return 0.6      # unknown age: neither fresh nor assumed stale

    score = 0.5 ** (age_h / hl)
    # A live session makes current data more informative, so lift fresh
    # readings while leaving genuinely old ones alone.
    if market_open_now(now) and age_h < 24.0:
        score = min(1.0, score * 1.15)
    return float(max(0.2, min(1.0, score)))


def _reliability(store, agent: str, regime: str) -> float:
    if store is None:
        return RELIABILITY_PRIOR
    try:
        s = store.score(agent, regime)
        if isinstance(s, dict):
            for k in ("score", "reliability", "mean", "quality"):
                if isinstance(s.get(k), (int, float)):
                    return float(max(0.05, min(1.0, s[k])))
            return RELIABILITY_PRIOR
        if isinstance(s, (int, float)):
            return float(max(0.05, min(1.0, s)))
    except Exception:
        pass
    return RELIABILITY_PRIOR


def compute_weights(results: List[AgentResult], regime: str = "unknown",
                    reliability_store=None,
                    now: Optional[datetime] = None) -> FusionWeights:
    """Normalised per-agent weights, with every factor recorded."""
    usable = [r for r in results if r.usable]
    fw = FusionWeights(regime=regime)
    if not usable:
        fw.explanation = "no usable agent results; nothing to weight"
        return fw

    raw: Dict[str, float] = {}
    for r in usable:
        name = r.agent.value
        c = max(0.01, float(r.confidence))
        rel = _reliability(reliability_store, name, regime)
        f = freshness_score(r, now)
        w = (c ** ALPHA_CONFIDENCE) * (rel ** BETA_RELIABILITY) * (f ** GAMMA_FRESHNESS)
        raw[name] = w
        fw.components[name] = {
            "confidence": round(c, 4), "reliability": round(rel, 4),
            "freshness": round(f, 4), "raw_weight": round(w, 6),
        }

    total = sum(raw.values()) or 1.0
    fw.weights = {k: round(v / total, 4) for k, v in raw.items()}
    top = max(fw.weights, key=fw.weights.get)
    fw.explanation = (
        f"{len(usable)} agents weighted in {regime} regime; "
        f"{top} carries {fw.weights[top]:.0%} "
        f"(confidence {fw.components[top]['confidence']:.2f}, "
        f"reliability {fw.components[top]['reliability']:.2f}, "
        f"freshness {fw.components[top]['freshness']:.2f})")
    return fw


# --------------------------------------------------------------------------

_DIRECTION_VALUE = {"up": 1.0, "flat": 0.0, "down": -1.0}


def _agent_direction(r: AgentResult) -> Optional[str]:
    p = r.payload or {}
    if r.agent is AgentName.ANALYST:
        return p.get("direction")
    if r.agent is AgentName.MARKET:
        return {"up": "up", "down": "down", "sideways": "flat"}.get(p.get("trend"))
    if r.agent is AgentName.RESEARCHER:
        return {"positive": "up", "negative": "down", "neutral": "flat"}.get(p.get("level"))
    return None


def fuse(results: List[AgentResult], regime: str = "unknown",
         reliability_store=None, risk_posture: str = "medium",
         now: Optional[datetime] = None) -> Tuple[Dict, FusionWeights]:
    """Weighted directional vote plus a risk-derived position size."""
    fw = compute_weights(results, regime, reliability_store, now)

    # Renormalise over agents that actually express a direction. Risk and
    # fundamentals carry real weight for sizing but cast no directional vote,
    # so leaving them in the denominator would be dead mass: with risk
    # typically near half the total weight, a unanimous bullish read could
    # never score above ~0.5, and the system would drift toward "hold" the
    # more confident its risk estimate became. The full weight vector is
    # still reported in `fw` -- only the vote is renormalised.
    directional = {}
    for r in results:
        if not r.usable:
            continue
        d = _agent_direction(r)
        if d is None:
            continue        # risk/fundamentals inform sizing, not direction
        directional[r.agent.value] = (fw.weights.get(r.agent.value, 0.0),
                                      _DIRECTION_VALUE.get(d, 0.0))

    contributing = len(directional)
    dir_total = sum(w for w, _ in directional.values())
    score = (sum(w * v for w, v in directional.values()) / dir_total) if dir_total else 0.0
    fw.components["_directional_share"] = {
        "voting_weight_before_renorm": round(dir_total, 4),
        "voters": float(contributing),
    }

    if score > 0.15:
        action, direction = "buy", "up"
    elif score < -0.15:
        action, direction = "sell", "down"
    else:
        action, direction = "hold", "flat"

    # Sizing comes from the Risk agent when present. Absent it, the position
    # is zero: a system that will size a trade without a downside estimate is
    # the thing this architecture exists to avoid.
    risk = next((r for r in results
                 if r.agent is AgentName.RISK and r.usable), None)
    if risk is None:
        position_pct, sizing = 0.0, "no risk estimate available; position not sized"
    else:
        base = float((risk.payload or {}).get("position_pct", 0.0))
        # Scale by conviction so a marginal signal takes a smaller position
        # than an emphatic one.
        position_pct = base * min(1.0, abs(score) / 0.5) if action != "hold" else 0.0
        sizing = (f"{base:.0f}% base for {risk_posture} posture, "
                  f"scaled to {position_pct:.1f}% by conviction {abs(score):.2f}")

    decision = {
        "action": action,
        "direction": direction,
        "score": round(score, 4),
        "confidence": round(min(0.95, abs(score) * 1.6), 4),
        "position_pct": round(position_pct, 2),
        "contributing_agents": contributing,
        "sizing_rationale": sizing,
    }
    return decision, fw
