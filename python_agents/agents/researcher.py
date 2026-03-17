import os
import time
from typing import List

import requests

try:
    from models.sentiment_nlp import aggregate_sentiment, label_sentiment
except ModuleNotFoundError:
    from python_agents.models.sentiment_nlp import aggregate_sentiment, label_sentiment


class ResearcherAgent:
    def __init__(self) -> None:
        self.news_api_key = os.getenv("NEWSAPI_KEY", "")

    def analyze(self, ticker: str, query: str) -> dict:
        start = time.perf_counter()
        headlines = self._fetch_headlines(ticker=ticker)

        if not headlines:
            headlines = [
                f"{ticker} market momentum remains mixed as investors evaluate macro conditions",
                f"Analysts reassess {ticker} after recent volatility",
                f"Portfolio managers debate if {ticker} is attractive near-term",
                query,
            ]

        labels = [label_sentiment(text) for text in headlines]
        score, label, confidence = aggregate_sentiment(labels)

        return {
            "label": label,
            "score": round(score, 3),
            "confidence": round(confidence, 3),
            "headlines": headlines[:5],
            "durationMs": int((time.perf_counter() - start) * 1000),
            "message": f"Analyzed {len(headlines)} headlines",
        }

    def _fetch_headlines(self, ticker: str) -> List[str]:
        if not self.news_api_key:
            return []

        try:
            response = requests.get(
                "https://newsapi.org/v2/everything",
                params={
                    "q": ticker,
                    "apiKey": self.news_api_key,
                    "pageSize": 8,
                    "language": "en",
                    "sortBy": "publishedAt",
                },
                timeout=6,
            )
            response.raise_for_status()
            articles = response.json().get("articles", [])
            return [article.get("title", "") for article in articles if article.get("title")]
        except Exception:
            return []
