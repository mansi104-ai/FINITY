"""Per-agent scoring: how good is each agent, on its own?

The fused decision tells you how the system did. It does not tell you which
agent earned that, and without it the reliability layer stays pinned to its
0.50 prior and the dynamic weighting has nothing to be dynamic about.

Each agent's directional call is recoverable from the ``agent_evidence``
recorded on every prediction:

    analyst     payload["direction"]           up / down / flat
    market      payload["trend"]               up / down / sideways
    researcher  payload["level"]               positive / negative / neutral
    risk        (none -- sizes, does not vote)
    fundamentals(none)

Scoring one against the realised move gives that agent's own hit rate, which
feeds ``ReliabilityStore`` keyed by (agent, regime) and closes the loop:
measured accuracy in the current regime becomes the ``reliability`` term in
next week's fusion weight.

Two decisions worth stating, because both could reasonably have gone the
other way:

**Flat calls are scored, not skipped.** An agent that says "flat" when the
market moves 3% was wrong, and dropping those would flatter every agent that
hedges. A flat call counts as correct only when the realised move is inside
the same dead band the agent's own threshold implies.

**Credit is per-agent, not per-decision.** An agent is scored on what it
said, regardless of whether the fusion followed it. Otherwise a well-judged
minority view looks like a failure whenever it is outvoted, and the
weighting would learn to suppress exactly the disagreement that makes an
ensemble worth having.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parents[1] / "python_agents"))
sys.path.insert(0, str(_HERE))

from store import PredictionStore  # noqa: E402

# The dead band a "flat" call is judged against. Matches the +/-0.05%
# threshold arm A uses to emit "flat", so an agent is held to the same
# standard it was allowed to apply.
FLAT_BAND = 0.0005


def agent_direction(agent: str, payload: Dict[str, Any]) -> Optional[str]:
    """The directional call an agent's payload implies, or None if it casts no vote."""
    if not isinstance(payload, dict):
        return None
    if agent == "analyst":
        return payload.get("direction")
    if agent == "market":
        return {"up": "up", "down": "down", "sideways": "flat"}.get(payload.get("trend"))
    if agent == "researcher":
        return {"positive": "up", "negative": "down",
                "neutral": "flat"}.get(payload.get("level"))
    return None      # risk, fundamentals: inform sizing, not direction


def realised_direction(ret: float) -> str:
    if ret > FLAT_BAND:
        return "up"
    if ret < -FLAT_BAND:
        return "down"
    return "flat"


def score(store: PredictionStore, record_to_reliability: bool = False
          ) -> Tuple[Dict[str, Any], int]:
    """Per-agent hit rates over every scored prediction.

    Set ``record_to_reliability`` to feed the results into the live
    ReliabilityStore. Off by default: the function is also used for
    read-only reporting, and double-recording would corrupt the track record
    that the fusion weights depend on.
    """
    preds = {p["decision_id"]: p for p in store.predictions()}
    outcomes = store.outcomes()

    tally: Dict[Tuple[str, str], Dict[str, float]] = defaultdict(
        lambda: {"n": 0, "correct": 0, "up": 0, "down": 0, "flat": 0})
    fused: Dict[Tuple[str, str], Dict[str, float]] = defaultdict(
        lambda: {"n": 0, "correct": 0})

    rel = None
    if record_to_reliability:
        from services.reliability import get_reliability_store
        rel = get_reliability_store()

    scored = 0
    for o in outcomes:
        p = preds.get(o.get("decision_id"))
        if not p:
            continue
        truth = o.get("realized_direction") or realised_direction(
            float(o.get("realized_return", 0.0)))
        regime = p.get("regime") or "unknown"
        arm = p.get("arm", "?")
        scored += 1

        # The fused decision, for comparison against its own parts.
        f = fused[(f"FUSED-arm{arm}", regime)]
        f["n"] += 1
        f["correct"] += int(p.get("direction") == truth)

        for agent, payload in (p.get("agent_evidence") or {}).items():
            d = agent_direction(agent, payload)
            if d is None:
                continue
            t = tally[(agent, regime)]
            t["n"] += 1
            t["correct"] += int(d == truth)
            t[d] = t.get(d, 0) + 1
            if rel is not None:
                rel.record(agent, regime, 1.0 if d == truth else 0.0)

    def summarise(d):
        out = {}
        for (name, regime), v in sorted(d.items()):
            acc = v["correct"] / v["n"] if v["n"] else None
            out.setdefault(name, {})[regime] = {
                "n": v["n"], "correct": v["correct"],
                "accuracy": round(acc, 4) if acc is not None else None,
                "calls": {k: v.get(k, 0) for k in ("up", "down", "flat")
                          if k in v},
            }
        return out

    return {"agents": summarise(tally), "fused": summarise(fused),
            "outcomes_scored": scored}, scored


def _wilson(k: int, n: int, z: float = 1.96) -> Tuple[float, float]:
    """Wilson score interval -- valid at the small n a young forward test has,
    unlike the normal approximation, which produces impossible bounds there."""
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / d
    half = z * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5) / d
    return (max(0.0, centre - half), min(1.0, centre + half))


def report(result: Dict[str, Any]) -> None:
    n = result["outcomes_scored"]
    print(f"scored outcomes: {n}")
    if n == 0:
        print("\nNothing to score yet. Predictions are sealed but their horizons")
        print("have not elapsed, so no agent has a track record and every")
        print("reliability term is still the 0.50 prior.")
        return

    for section, title in (("agents", "PER-AGENT"), ("fused", "FUSED DECISION")):
        block = result[section]
        if not block:
            continue
        print(f"\n--- {title} ---")
        print(f"  {'name':<14}{'regime':<12}{'n':>5}{'acc':>8}   95% CI")
        for name, regimes in sorted(block.items()):
            for regime, v in sorted(regimes.items()):
                lo, hi = _wilson(v["correct"], v["n"])
                acc = f"{v['accuracy']:.3f}" if v["accuracy"] is not None else "   -"
                flag = "" if (lo > 0.5 or hi < 0.5) else "   (CI spans 0.5)"
                print(f"  {name:<14}{regime:<12}{v['n']:>5}{acc:>8}   "
                      f"[{lo:.2f}, {hi:.2f}]{flag}")

    print("\nA CI spanning 0.50 means the agent is not yet distinguishable from")
    print("a coin flip in that regime. Early in a forward test that is the")
    print("expected state, not a finding.")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=None)
    ap.add_argument("--record", action="store_true",
                    help="feed results into the live ReliabilityStore")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    store = PredictionStore(Path(a.root)) if a.root else PredictionStore()
    result, n = score(store, record_to_reliability=a.record)

    if a.json:
        print(json.dumps(result, indent=2))
    else:
        report(result)

    if a.record and n:
        from services.reliability import get_reliability_store
        print("\nReliabilityStore updated:")
        print(json.dumps(get_reliability_store().snapshot(), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
