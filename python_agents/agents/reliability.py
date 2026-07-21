"""Agent Reliability service (FINDEC v1 -- Phase "Agent Reliability").

From the FINDEC v1 replanning discussion:

    "Every agent should have a reliability profile ... The planner uses
    these values to decide how much to trust each agent in the current
    context. That gives you an adaptive system rather than one with
    fixed weights."

This module is the concrete implementation of that idea. It is
deliberately small and dependency-free (stdlib only) so it works the
same way locally and on a serverless deployment.

Design
------
For each (agent, context) pair we keep a Beta-distribution-style running
count: `successes` (quality-weighted) and `trials`. `context` buckets
observations by conditions that plausibly change an agent's trustworthiness
(currently: overall, and the market's realized-volatility regime), the way
the design doc's example does with sector/asset-class buckets:

    {"ResearcherAgent": {"overall": 0.91, "high_volatility": 0.72}}

Every agent already produces a self-contained "how good was this
particular run" signal:

- Researcher: dataAvailable (live news actually retrieved) and confidence.
- Market Agent: dataAvailable (live/Stooq price history retrieved).
- Analyst: the walk-forward backtest's directional accuracy -- a
  genuinely-measured number, not a guess, computed fresh on every request.
- Risk Manager: dataAvailable (VaR computed from real historical returns,
  not skipped).

crew.py records one `quality` observation (0..1) per agent per request via
`record_outcome`, then reads back a smoothed reliability score BEFORE
using it to weight that same agent's contribution to the buy score.
Reading happens before writing so a request is scored using reliability
built up from *previous* requests, never from itself.

Persistence
-----------
Reliability is written to a small JSON file so it survives process
restarts on a normal server. On serverless (e.g. Vercel functions,
which this repo also targets -- see Dockerfile / index.py) the
filesystem outside /tmp is read-only and /tmp itself is wiped on cold
start, so reliability there resets periodically. That is a known,
documented limitation, not a silent failure: every write is wrapped so a
read-only filesystem degrades to in-memory-only tracking for the life of
the process rather than crashing a request. The `Persistence` box in the
FINDEC architecture diagram (MongoDB, v3+) is the intended fix for
cross-instance persistence; swapping the storage backend only requires
implementing `_load`/`_save` against Mongo instead of a JSON file.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Dict, Optional

# Bayesian prior: assume an agent is reasonably trustworthy (0.75) before
# any evidence, with a weight equivalent to 4 "virtual" prior observations.
# This avoids a brand-new agent/context swinging to 0.0 or 1.0 after a
# single run, while still letting real evidence dominate quickly.
PRIOR_SCORE = 0.75
PRIOR_WEIGHT = 4.0

DEFAULT_STORE_PATH = os.getenv("FINDEC_RELIABILITY_PATH", "/tmp/findec_reliability_store.json")

_LOCK = threading.Lock()


class ReliabilityStore:
    """File-backed store of {agent: {context: {"successes": f, "trials": f}}}."""

    def __init__(self, path: Optional[str] = None) -> None:
        self.path = Path(path or DEFAULT_STORE_PATH)
        self._data: Dict[str, Dict[str, Dict[str, float]]] = {}
        self._writable = True
        self._load()

    def _load(self) -> None:
        try:
            if self.path.exists():
                with self.path.open("r", encoding="utf-8") as fh:
                    loaded = json.load(fh)
                if isinstance(loaded, dict):
                    self._data = loaded
        except Exception:
            # Corrupt or unreadable file: start clean rather than crash.
            self._data = {}

    def _save(self) -> None:
        if not self._writable:
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp_path = self.path.with_suffix(".tmp")
            with tmp_path.open("w", encoding="utf-8") as fh:
                json.dump(self._data, fh)
            tmp_path.replace(self.path)
        except Exception:
            # Read-only filesystem, no /tmp, etc. Keep tracking in memory
            # for the life of this process; stop attempting writes so we
            # don't pay the cost of a failing syscall on every request.
            self._writable = False

    def record(self, agent: str, context: str, quality: float) -> None:
        quality = max(0.0, min(1.0, float(quality)))
        with _LOCK:
            agent_bucket = self._data.setdefault(agent, {})
            ctx_bucket = agent_bucket.setdefault(context, {"successes": 0.0, "trials": 0.0})
            ctx_bucket["successes"] += quality
            ctx_bucket["trials"] += 1.0
            self._save()

    def score(self, agent: str, context: str) -> Dict[str, float]:
        with _LOCK:
            ctx_bucket = (self._data.get(agent) or {}).get(context, {"successes": 0.0, "trials": 0.0})
            successes = ctx_bucket.get("successes", 0.0)
            trials = ctx_bucket.get("trials", 0.0)

        # Bayesian-smoothed score: blends the prior with observed evidence,
        # so the weight of the prior shrinks automatically as trials grow.
        smoothed = (successes + PRIOR_SCORE * PRIOR_WEIGHT) / (trials + PRIOR_WEIGHT)
        return {
            "score": round(smoothed, 4),
            "sampleSize": int(trials),
            "context": context,
        }

    def snapshot(self) -> Dict[str, Dict[str, Dict[str, float]]]:
        """Full dump for the /reliability debug endpoint."""
        with _LOCK:
            out: Dict[str, Dict[str, Dict[str, float]]] = {}
            for agent, contexts in self._data.items():
                out[agent] = {}
                for context, ctx_bucket in contexts.items():
                    trials = ctx_bucket.get("trials", 0.0)
                    successes = ctx_bucket.get("successes", 0.0)
                    smoothed = (successes + PRIOR_SCORE * PRIOR_WEIGHT) / (trials + PRIOR_WEIGHT)
                    out[agent][context] = {"score": round(smoothed, 4), "sampleSize": int(trials)}
            return out


_singleton: Optional[ReliabilityStore] = None


def get_reliability_store() -> ReliabilityStore:
    global _singleton
    if _singleton is None:
        _singleton = ReliabilityStore()
    return _singleton


def volatility_context(volatility_pct: Optional[float]) -> str:
    """Buckets a market's 20-day volatility into a reliability context.

    Distinct from the "overall" context: an agent can be reliable in calm
    markets and much less reliable in high-volatility ones (a Ridge
    regressor's directional accuracy, for instance, typically degrades as
    realized volatility rises). Falls back to "unknown_volatility" when
    the Market Agent had no data to compute volatility from.
    """
    if volatility_pct is None:
        return "unknown_volatility"
    if volatility_pct < 2.0:
        return "low_volatility"
    if volatility_pct < 4.0:
        return "medium_volatility"
    return "high_volatility"


def blended_reliability(store: ReliabilityStore, agent: str, context: str) -> Dict[str, float]:
    """Combines the agent's overall reliability with its context-specific
    reliability. Context-specific evidence is weighted by how much of it
    exists (`sampleSize`), so a context with few observations mostly
    falls back to the agent's overall track record instead of overfitting
    to a handful of runs.
    """
    overall = store.score(agent, "overall")
    if context == "overall":
        return overall

    ctx = store.score(agent, context)
    ctx_weight = min(1.0, ctx["sampleSize"] / 15.0)  # ramps up to full trust over 15 observations
    blended_score = ctx_weight * ctx["score"] + (1 - ctx_weight) * overall["score"]
    return {
        "score": round(blended_score, 4),
        "sampleSize": ctx["sampleSize"],
        "context": context,
        "overallScore": overall["score"],
        "overallSampleSize": overall["sampleSize"],
    }