import os, requests
from models.sentiment_nlp import label_sentiment

NEWSAPI_KEY = os.getenv("NEWSAPI_KEY")

class ResearcherAgent:
    def analyze(self, ticker: str) -> dict:
        articles = self._fetch_news(ticker)
        labels   = [label_sentiment(a["title"]) for a in articles]

        bullish = labels.count("bullish")
        bearish = labels.count("bearish")
        score   = bullish / len(labels) if labels else 0.5

        return {
            "label":    "bullish" if score > 0.5 else "bearish",
            "score":    round(score, 2),
            "articles": len(articles)
        }

    def _fetch_news(self, ticker: str) -> list:
        # TODO: call NewsAPI
        url = "https://newsapi.org/v2/everything"
        params = {"q": ticker, "apiKey": NEWSAPI_KEY,
                  "pageSize": 10, "language": "en"}
        res = requests.get(url, params=params)
        return res.json().get("articles", [])