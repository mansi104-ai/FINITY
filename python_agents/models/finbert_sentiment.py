"""FinBERT sentiment (local model, no API key).

Drop-in replacement for the lexicon-based `label_sentiment` in
sentiment_nlp.py: same signature (text -> 5-level label), so researcher.py
can call whichever is available without changing its own logic.

Lazy-loaded and cached at module level so the ~400MB model is only
downloaded/loaded once per process, and only if it's actually used.
If `transformers`/`torch` aren't installed, or the model can't be
downloaded (no network, restricted egress, etc.), `classify()` returns
None and the caller falls back to the lexicon labeler -- same fail-soft
contract as the LLM client.
"""

from typing import Optional

MODEL_NAME = "ProsusAI/finbert"

_pipeline = None
_load_attempted = False
_load_failed = False


def _get_pipeline():
    global _pipeline, _load_attempted, _load_failed
    if _pipeline is not None:
        return _pipeline
    if _load_failed:
        return None
    _load_attempted = True
    try:
        from transformers import pipeline  # type: ignore

        _pipeline = pipeline("sentiment-analysis", model=MODEL_NAME, tokenizer=MODEL_NAME)
        return _pipeline
    except Exception:
        _load_failed = True
        return None


def is_available() -> bool:
    """Cheap check without triggering a load: has loading already succeeded?"""
    return _pipeline is not None


def classify(text: str) -> Optional[str]:
    """Returns a 5-level label (STRONG_BUY..STRONG_SELL) or None on failure.

    FinBERT itself outputs 3 classes (positive/negative/neutral) with a
    confidence score; we widen positive/negative into STRONG_* when the
    model's own confidence is high, so the output stays comparable to the
    existing 5-level lexicon scale used everywhere else in the pipeline.
    """
    pipe = _get_pipeline()
    if pipe is None:
        return None
    try:
        result = pipe(text[:512])[0]  # FinBERT's tokenizer truncates around 512 tokens anyway
        label = str(result.get("label", "neutral")).lower()
        score = float(result.get("score", 0.5))

        if label == "positive":
            return "STRONG_BUY" if score >= 0.85 else "BUY"
        if label == "negative":
            return "STRONG_SELL" if score >= 0.85 else "SELL"
        return "HOLD"
    except Exception:
        return None