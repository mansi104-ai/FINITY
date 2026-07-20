"""Shared Anthropic LLM client used by the Planner, Risk Reasoning,
Verification, and Explanation agents.

This module did not exist in the crashing commit -- every agent that
imported `from ..services.llm_client import get_llm_client` was raising
ModuleNotFoundError at process start, which is why the FastAPI deployment
was failing before it ever bound to a port. This file is the fix.

Design contract (fail-soft, never fail-hard):
- If ANTHROPIC_API_KEY is unset, or the `anthropic` package isn't
  installed, or the network call errors, or the model's reply isn't
  valid JSON, every method here returns None. It NEVER raises.
- Every caller (planner.py, risk_reasoning.py, verification.py,
  explanation.py) already has a deterministic fallback path for a None
  result -- that is what keeps FINDEC usable without an LLM key, and is
  the reason nothing in this file is allowed to throw.
"""

from __future__ import annotations

import json
import os
from typing import Optional

try:
    import anthropic  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    anthropic = None  # type: ignore

# Override with ANTHROPIC_MODEL if your account/plan uses a different model
# string. Check https://docs.claude.com for the current list of model IDs --
# this default is a reasonable current choice but may need updating.
DEFAULT_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")


class LLMClient:
    """Thin wrapper around the Anthropic Messages API with JSON/text helpers."""

    def __init__(self) -> None:
        self.api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
        self.model = DEFAULT_MODEL
        self._client = None
        self.available = bool(self.api_key) and anthropic is not None

        if self.available:
            try:
                self._client = anthropic.Anthropic(api_key=self.api_key)
            except Exception:
                self.available = False
                self._client = None

    def complete_json(self, system: str, user: str, max_tokens: int = 400) -> Optional[dict]:
        """Calls the model expecting a raw JSON object back. Returns None on
        any failure -- missing key, network error, malformed JSON, etc."""
        raw = self._call(system=system, user=user, max_tokens=max_tokens)
        if raw is None:
            return None
        try:
            return json.loads(_strip_code_fences(raw))
        except Exception:
            return None

    def complete(self, system: str, user: str, max_tokens: int = 300) -> Optional[str]:
        """Calls the model expecting plain text back. Returns None on failure."""
        raw = self._call(system=system, user=user, max_tokens=max_tokens)
        if raw is None:
            return None
        text = raw.strip()
        return text or None

    def _call(self, system: str, user: str, max_tokens: int) -> Optional[str]:
        if not self.available or self._client is None:
            return None
        try:
            response = self._client.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user}],
            )
            parts = [
                block.text
                for block in getattr(response, "content", [])
                if getattr(block, "type", "") == "text"
            ]
            return "".join(parts)
        except Exception:
            return None


def _strip_code_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return text


_singleton: Optional[LLMClient] = None


def get_llm_client() -> LLMClient:
    """Process-wide singleton so we don't re-read env vars / re-init the SDK
    client on every agent call."""
    global _singleton
    if _singleton is None:
        _singleton = LLMClient()
    return _singleton
