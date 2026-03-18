from typing import Iterable, Tuple, Dict

# Sentiment word weights on a scale of -2 to +2
EXTREME_POSITIVE_WORDS = {  # Weight: +2 (Strong Buy signals)
    "breakthrough",
    "exceptional",
    "outstanding",
    "record",
    "surge",
    "soar",
    "skyrocket",
    "explode",
    "dominate",
    "leadership",
    "momentum",
    "accelerate",
    "efficient",
    "strategic",
    "competitive_advantage",
    "market_leader",
    "innovation",
    "best-in-class",
}

POSITIVE_WORDS = {  # Weight: +1 (Buy signals)
    "beat",
    "gain",
    "growth",
    "bullish",
    "buy",
    "upgrade",
    "rally",
    "strong",
    "profit",
    "upside",
    "outperform",
    "opportunity",
    "potential",
    "upbeat",
    "thrive",
    "prosper",
    "success",
    "positive",
    "excellent",
    "improvement",
    "advance",
    "higher",
    "exceed",
    "efficient",
    "sustainable",
    "confidence",
    "conviction",
    "catalyst",
    "strength",
    "attract",
    "expansion",
    "robust",
}

NEUTRAL_WORDS = {  # Weight: 0 (Hold signals)
    "balanced",
    "mixed",
    "uncertain",
    "uncertain",
    "stability",
    "maintain",
    "steady",
    "neutral",
    "moderate",
    "cautious",
    "debate",
    "diverge",
}

NEGATIVE_WORDS = {  # Weight: -1 (Sell signals)
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
    "downside",
    "underperform",
    "challenge",
    "headwind",
    "concern",
    "uncertainty",
    "volatility",
    "pressure",
    "contraction",
    "slowdown",
    "weakness",
    "deteriorate",
    "failure",
    "negative",
    "poor",
    "bad",
    "slump",
    "turmoil",
    "shortage",
    "deficit",
    "distress",
}

EXTREME_NEGATIVE_WORDS = {  # Weight: -2 (Strong Sell signals)
    "collapse",
    "crash",
    "plunge",
    "bankruptcy",
    "liquidation",
    "fraud",
    "scandal",
    "crisis",
    "recession",
    "depression",
    "catastrophic",
    "disaster",
    "devastating",
    "terrible",
    "awful",
    "horrible",
    "toxic",
    "poison",
    "deadly",
    "threatened",
}


def label_sentiment(text: str) -> str:
    """Classify text into 5-level sentiment: STRONG_SELL, SELL, HOLD, BUY, STRONG_BUY"""
    tokens = {token.strip(".,!?;:\"'()[]{}$#@!~").lower() for token in text.split()}
    
    # Calculate weighted sentiment score
    score = 0.0
    score += len(tokens & EXTREME_POSITIVE_WORDS) * 2
    score += len(tokens & POSITIVE_WORDS) * 1
    score += len(tokens & NEUTRAL_WORDS) * 0
    score -= len(tokens & NEGATIVE_WORDS) * 1
    score -= len(tokens & EXTREME_NEGATIVE_WORDS) * 2
    
    # Normalize if there are tokens
    total_sentiment_words = (
        len(tokens & EXTREME_POSITIVE_WORDS) +
        len(tokens & POSITIVE_WORDS) +
        len(tokens & NEGATIVE_WORDS) +
        len(tokens & EXTREME_NEGATIVE_WORDS)
    )
    
    if total_sentiment_words == 0:
        return "HOLD"
    
    normalized_score = score / total_sentiment_words
    
    # Map to 5-level scale
    if normalized_score >= 1.5:
        return "STRONG_BUY"
    elif normalized_score >= 0.5:
        return "BUY"
    elif normalized_score >= -0.5:
        return "HOLD"
    elif normalized_score >= -1.5:
        return "SELL"
    else:
        return "STRONG_SELL"


def aggregate_sentiment(labels: Iterable[str]) -> Tuple[float, str, float, Dict]:
    """Aggregate multiple sentiment labels into a single score and level"""
    values = []
    sentiment_map = {
        "STRONG_BUY": 2.0,
        "BUY": 1.0,
        "HOLD": 0.0,
        "SELL": -1.0,
        "STRONG_SELL": -2.0,
    }
    
    synthesis = {
        "strong_buy": 0,
        "buy": 0,
        "hold": 0,
        "sell": 0,
        "strong_sell": 0,
    }
    
    for label in labels:
        value = sentiment_map.get(label, 0.0)
        values.append(value)
        
        # Track counts for synthesis
        if label == "STRONG_BUY":
            synthesis["strong_buy"] += 1
        elif label == "BUY":
            synthesis["buy"] += 1
        elif label == "HOLD":
            synthesis["hold"] += 1
        elif label == "SELL":
            synthesis["sell"] += 1
        elif label == "STRONG_SELL":
            synthesis["strong_sell"] += 1

    if not values:
        return 0.0, "HOLD", 0.5, synthesis

    score = sum(values) / len(values)
    
    # Determine final level based on aggregated score
    if score >= 1.5:
        level = "STRONG_BUY"
    elif score >= 0.5:
        level = "BUY"
    elif score >= -0.5:
        level = "HOLD"
    elif score >= -1.5:
        level = "SELL"
    else:
        level = "STRONG_SELL"

    # Better confidence scoring based on consensus
    max_count = max(synthesis.values())
    total = len(values)
    consensus_ratio = max_count / total if total > 0 else 0
    confidence = min(0.95, 0.5 + abs(score) * 0.3 + consensus_ratio * 0.25)
    
    return round(score, 3), level, round(confidence, 3), synthesis
