from transformers import pipeline

# Load once at module level (expensive)
_classifier = None

def get_classifier():
    global _classifier
    if _classifier is None:
        _classifier = pipeline(
            "text-classification",
            model="ProsusAI/finbert"
        )
    return _classifier

def label_sentiment(text: str) -> str:
    """Returns 'bullish', 'bearish', or 'neutral'"""
    result = get_classifier()(text[:512])[0]
    label  = result["label"].lower()
    # FinBERT returns: positive, negative, neutral
    mapping = {"positive": "bullish", "negative": "bearish",
               "neutral": "neutral"}
    return mapping.get(label, "neutral")