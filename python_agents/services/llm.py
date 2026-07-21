"""OpenRouter-backed language-model client for FINDEC's control plane.

Replaces the Anthropic-only ``llm_client.py``, which was written against a
key this deployment does not have and which asked for JSON in the prompt and
hoped. The free-tier probe settled that question: no model returned a
conforming object when merely asked, while three of four did under
schema-enforced decoding.

Three concerns beyond a plain API wrapper, all of them forced by running the
control plane on free-tier inference:

**Budget governor.** Free tier allows roughly 50 requests/day. A 50-ticker
forward test that oversends on a Tuesday has silently lost that day's data,
and a gap in a sealed prediction series cannot be backfilled without
reintroducing the contamination the forward test exists to avoid. The
governor therefore enforces a hard per-category daily cap that survives
process restarts, and refuses rather than overspends.

**Cache.** Plans key on query *shape*, not on the date, so the same
structural question asked on ninety consecutive days costs one call rather
than ninety. This is what closes the budget arithmetic.

**Fallback chain.** Free endpoints return 429 and 503 routinely. A refusal
here must degrade to the deterministic path, never propagate.

Nothing in this module raises. Every failure returns ``None``, because each
caller has a deterministic fallback and a live forward test must not die on
a transient upstream error.
"""

from __future__ import annotations

import json
import hashlib
import os
import random
import re
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional

API_URL = "https://openrouter.ai/api/v1/chat/completions"

# Ordered by measured quality on the planning probe. nemotron-super was both
# fastest (7.5s vs 26s and 35s) and the only model to get every field of the
# hostile probe query right; gemma is a genuine second. gpt-oss-20b failed
# schema mode outright and is deliberately absent.
DEFAULT_MODELS = [
    "nvidia/nemotron-3-super-120b-a12b:free",
    "google/gemma-4-26b-a4b-it:free",
    "nvidia/nemotron-nano-9b-v2:free",
]

_STATE_DIR = Path(os.getenv("FINDEC_STATE_DIR", Path.home() / ".findec"))
_BUDGET_PATH = _STATE_DIR / "llm_budget.json"
_CACHE_DIR = _STATE_DIR / "llm_cache"

# Daily call ceiling and its split across control-plane roles. The split
# matters: without it a chatty Optimizer on a volatile morning consumes the
# whole allowance and the Auditor never runs.
DAILY_BUDGET = int(os.getenv("FINDEC_LLM_DAILY_BUDGET", "45"))

# Shares reflect measured day-1 demand, not an even split.
#
#   planner    ~1/day. Plans cache on query shape, so a 40-ticker run costs
#              one call on the first day and zero after. Headroom is for
#              cache misses and prompt-version bumps.
#   optimizer  the real consumer: one screen per ticker per arm, of which the
#              conflicted minority escalate to a call. Day 1 hit its 15-call
#              ceiling partway through the universe, leaving later tickers
#              unadjudicated.
#   researcher 0/day. FinBERT scores sentiment locally.
#   curator    0/day. Deterministic by design.
#   auditor    ~1/day. The whole day batches into one request.
CATEGORY_SHARE = {
    "planner": 0.10,
    "optimizer": 0.60,
    "auditor": 0.15,
    "researcher": 0.05,
    "curator": 0.02,
    "probe": 0.08,
}


# --------------------------------------------------------------------------

@dataclass
class LLMResponse:
    data: Dict[str, Any]
    model: str
    tokens: int
    duration_ms: int
    cached: bool = False


class BudgetExhausted(Exception):
    """Internal control-flow signal; never escapes the client."""


class _Budget:
    """Per-day, per-category call ledger persisted to disk.

    Survives restarts on purpose. A forward test run by a scheduled job is
    a fresh process every morning, so an in-memory counter would reset the
    ceiling each run and quietly overspend.
    """

    def __init__(self, path: Path = _BUDGET_PATH, total: int = DAILY_BUDGET) -> None:
        self.path = path
        self.total = total
        self._lock = threading.Lock()
        self._day = ""
        self._counts: Dict[str, int] = {}
        self._load()

    def _load(self) -> None:
        today = date.today().isoformat()
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            if raw.get("day") == today:
                self._day, self._counts = today, dict(raw.get("counts", {}))
                return
        except Exception:
            pass
        self._day, self._counts = today, {}

    def _save(self) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps({"day": self._day, "counts": self._counts}),
                           encoding="utf-8")
            tmp.replace(self.path)
        except Exception:
            pass

    def _rollover(self) -> None:
        today = date.today().isoformat()
        if today != self._day:
            self._day, self._counts = today, {}

    def allow(self, category: str) -> bool:
        """Reserve one call. Returns False when the category is spent."""
        with self._lock:
            self._rollover()
            cap = max(1, int(self.total * CATEGORY_SHARE.get(category, 0.05)))
            used = self._counts.get(category, 0)
            if used >= cap:
                return False
            self._counts[category] = used + 1
            self._save()
            return True

    def refund(self, category: str) -> None:
        """Return an unspent reservation (cache hit, or upstream never called)."""
        with self._lock:
            if self._counts.get(category, 0) > 0:
                self._counts[category] -= 1
                self._save()

    def report(self) -> Dict[str, Any]:
        with self._lock:
            self._rollover()
            return {
                "day": self._day,
                "total": self.total,
                "used": sum(self._counts.values()),
                "by_category": {
                    c: {"used": self._counts.get(c, 0),
                        "cap": max(1, int(self.total * s))}
                    for c, s in CATEGORY_SHARE.items()
                },
            }


# --------------------------------------------------------------------------

def _load_key() -> str:
    key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if key:
        return key
    # Fall back to the repo's .env.local, which is where this project keeps
    # its keys; python-dotenv is not a dependency of the agent service.
    for candidate in (Path.cwd() / ".env.local",
                      Path(__file__).resolve().parents[2] / ".env.local"):
        try:
            for line in candidate.read_text(encoding="utf-8", errors="ignore").splitlines():
                if line.startswith("OPENROUTER_API_KEY="):
                    v = line.split("=", 1)[1].strip().strip('"').strip("'")
                    if v:
                        return v
        except Exception:
            continue
    return ""


def _strip_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t)
        t = re.sub(r"\s*```$", "", t)
    return t.strip()


class LLMClient:
    """Schema-constrained JSON client with budget, cache and failover."""

    def __init__(self, models: Optional[List[str]] = None,
                 budget: Optional[_Budget] = None,
                 cache_dir: Path = _CACHE_DIR) -> None:
        self.api_key = _load_key()
        self.models = models or DEFAULT_MODELS
        self.budget = budget or _Budget()
        self.cache_dir = cache_dir
        self.available = bool(self.api_key)
        self.last_error: Optional[str] = None

    # ---- cache --------------------------------------------------------

    def _cache_path(self, key: str) -> Path:
        return self.cache_dir / f"{key}.json"

    def _cache_get(self, key: Optional[str]) -> Optional[Dict[str, Any]]:
        if not key:
            return None
        try:
            return json.loads(self._cache_path(key).read_text(encoding="utf-8"))
        except Exception:
            return None

    def invalidate(self, key: Optional[str]) -> bool:
        """Drop a cached response.

        Needed because validation happens in the caller, after the client has
        already stored the reply. A response that is schema-valid but
        semantically unusable therefore gets cached, and every later call
        replays it and fails the same way -- a poisoned entry that silently
        pins the caller to its fallback path indefinitely. Callers invalidate
        on validation failure so the next attempt reaches the model.
        """
        if not key:
            return False
        try:
            self._cache_path(key).unlink()
            return True
        except Exception:
            return False

    def _cache_put(self, key: Optional[str], value: Dict[str, Any]) -> None:
        if not key:
            return
        try:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            p = self._cache_path(key)
            tmp = p.with_suffix(".tmp")
            tmp.write_text(json.dumps(value), encoding="utf-8")
            tmp.replace(p)
        except Exception:
            pass

    # ---- main entry point ---------------------------------------------

    def complete_json(
        self,
        system: str,
        user: str,
        schema: Dict[str, Any],
        schema_name: str = "response",
        category: str = "probe",
        cache_key: Optional[str] = None,
        max_tokens: int = 1600,
        timeout: int = 120,
    ) -> Optional[LLMResponse]:
        """Return a schema-conforming object, or None.

        None is a normal outcome -- budget exhausted, no key, upstream down --
        and every caller must have a deterministic path for it.
        """
        self.last_error = None

        cached = self._cache_get(cache_key)
        if cached is not None:
            return LLMResponse(data=cached, model="cache", tokens=0,
                               duration_ms=0, cached=True)

        if not self.available:
            self.last_error = "no OPENROUTER_API_KEY"
            return None

        if not self.budget.allow(category):
            self.last_error = f"daily budget exhausted for category '{category}'"
            return None

        body_base = {
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "max_tokens": max_tokens,
            "temperature": 0,
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": schema_name, "strict": True, "schema": schema},
            },
        }

        for model in self.models:
            for attempt in range(2):
                t0 = time.perf_counter()
                try:
                    req = urllib.request.Request(
                        API_URL,
                        data=json.dumps({**body_base, "model": model}).encode(),
                        headers={
                            "Authorization": f"Bearer {self.api_key}",
                            "Content-Type": "application/json",
                            # OpenRouter attributes traffic with these; they
                            # also raise free-tier priority slightly.
                            "HTTP-Referer": "https://github.com/mansi104-ai/FINITY",
                            "X-Title": "FINDEC",
                        },
                    )
                    with urllib.request.urlopen(req, timeout=timeout) as r:
                        payload = json.load(r)
                except urllib.error.HTTPError as e:
                    code = e.code
                    self.last_error = f"{model}: HTTP {code}"
                    # 429/503 are the free tier's normal weather: back off
                    # once, then let the next model try.
                    if code in (429, 503) and attempt == 0:
                        time.sleep(2.0 + random.random() * 2.0)
                        continue
                    break
                except Exception as e:
                    self.last_error = f"{model}: {type(e).__name__}: {e}"
                    if attempt == 0:
                        time.sleep(1.0)
                        continue
                    break

                dt_ms = int((time.perf_counter() - t0) * 1000)
                try:
                    text = payload["choices"][0]["message"]["content"]
                    data = json.loads(_strip_fences(text))
                except Exception as e:
                    self.last_error = f"{model}: unparseable response ({e})"
                    break

                if not isinstance(data, dict):
                    self.last_error = f"{model}: expected object, got {type(data).__name__}"
                    break

                tokens = int((payload.get("usage") or {}).get("total_tokens", 0))
                self._cache_put(cache_key, data)
                return LLMResponse(data=data, model=model, tokens=tokens,
                                   duration_ms=dt_ms)

        # Every model failed; the reservation bought nothing, so give it back.
        self.budget.refund(category)
        return None

    def budget_report(self) -> Dict[str, Any]:
        return self.budget.report()


_singleton: Optional[LLMClient] = None
_singleton_lock = threading.Lock()


def get_llm() -> LLMClient:
    global _singleton
    with _singleton_lock:
        if _singleton is None:
            _singleton = LLMClient()
    return _singleton


def stable_key(*parts: Any) -> str:
    """Deterministic cache key from arbitrary parts."""
    blob = json.dumps(parts, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()[:24]
