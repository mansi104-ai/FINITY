from typing import Iterable, Tuple

POSITIVE_WORDS = {
    "beat",
    "gain",
    "growth",
    "bullish",
    "buy",
    "upgrade",
    "rally",
    "strong",
    "profit",
    "surge",
}

NEGATIVE_WORDS = {
    "miss",
    "loss",
    "drop",
    "bearish",
    "sell",
    "downgrade",
    "decline",
    "weak",
    "risk",
    "lawsuit",
}


def label_sentiment(text: str) -> str:
    tokens = {token.strip(".,!?;:\"'()[]{}$").lower() for token in text.split()}
    positive_hits = len(tokens & POSITIVE_WORDS)
    negative_hits = len(tokens & NEGATIVE_WORDS)

    if positive_hits > negative_hits:
        return "bullish"
    if negative_hits > positive_hits:
        return "bearish"
    return "neutral"


def aggregate_sentiment(labels: Iterable[str]) -> Tuple[float, str, float]:
    values = []
    for label in labels:
        if label == "bullish":
            values.append(1.0)
        elif label == "bearish":
            values.append(0.0)
        else:
            values.append(0.5)

    if not values:
        return 0.5, "neutral", 0.5

    score = sum(values) / len(values)

    if score >= 0.58:
        label = "bullish"
    elif score <= 0.42:
        label = "bearish"
    else:
        label = "neutral"

    confidence = min(0.95, 0.5 + abs(score - 0.5) * 1.8)
    return score, label, confidence
