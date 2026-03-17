import os
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Tuple

import requests

try:
    from models.sentiment_nlp import aggregate_sentiment, label_sentiment
except ModuleNotFoundError:
    from python_agents.models.sentiment_nlp import aggregate_sentiment, label_sentiment


class ResearcherAgent:
    def __init__(self) -> None:
        self.news_api_key = os.getenv("NEWSAPI_KEY", "")

    def analyze(self, ticker: str, query: str) -> dict:
        start_perf = time.perf_counter()
        run_started = self._now_utc()

        search_queries = [
            ticker,
            f"{ticker} stock outlook",
            f"{ticker} earnings guidance",
        ]

        attempts: List[Dict] = []
        resources: List[Dict] = []

        for idx, search_query in enumerate(search_queries):
            phase = "from_scratch" if idx == 0 else "reiteration"
            search_started = self._now_utc()

            if not self.news_api_key:
                attempts.append(
                    {
                        "query": search_query,
                        "phase": phase,
                        "source": "newsapi",
                        "status": "skipped",
                        "resultCount": 0,
                        "startedAt": self._iso(search_started),
                        "endedAt": self._iso(self._now_utc()),
                        "note": "NEWSAPI_KEY missing; using synthetic research fallback.",
                    }
                )
                continue

            items, error_note = self._search_news(search_query)
            resources.extend(items)
            attempts.append(
                {
                    "query": search_query,
                    "phase": phase,
                    "source": "newsapi",
                    "status": "success" if not error_note else "failed",
                    "resultCount": len(items),
                    "startedAt": self._iso(search_started),
                    "endedAt": self._iso(self._now_utc()),
                    "note": error_note if error_note else "Search completed.",
                }
            )

        resources = self._dedupe_resources(resources)

        if not resources:
            resources = self._synthetic_resources(ticker=ticker, user_query=query)

        labels = []
        for resource in resources:
            label = label_sentiment(resource["title"])
            resource["sentimentLabel"] = label
            labels.append(label)

        score, label, confidence = aggregate_sentiment(labels)
        synthesis = self._synthesis(labels)
        timeline = self._timeline(resources=resources, generated_at=run_started)
        search_stats = self._search_stats(attempts)

        recommendation_bias = (
            "research bias suggests BUY"
            if label == "bullish"
            else "research bias suggests SELL"
            if label == "bearish"
            else "research bias suggests HOLD/WAIT"
        )

        reasoning = [
            (
                f"Collected {len(resources)} unique resources between {timeline['from']} and "
                f"{timeline['to']}."
            ),
            (
                f"Executed {search_stats['totalSearches']} search attempts "
                f"({search_stats['searchesFromScratch']} from-scratch + "
                f"{search_stats['reiterations']} reiterations), with "
                f"{search_stats['successfulSearches']} successful attempts."
            ),
            (
                f"Sentiment vote distribution: bullish={synthesis['bullish']}, "
                f"bearish={synthesis['bearish']}, neutral={synthesis['neutral']}."
            ),
            (
                f"Final researcher sentiment={label} (score={round(score, 3)}, "
                f"confidence={round(confidence, 3)}), therefore {recommendation_bias}."
            ),
        ]

        return {
            "label": label,
            "score": round(score, 3),
            "confidence": round(confidence, 3),
            "resources": resources,
            "timeline": timeline,
            "searchStats": search_stats,
            "searchAttempts": attempts,
            "reasoning": reasoning,
            "synthesis": synthesis,
            "durationMs": int((time.perf_counter() - start_perf) * 1000),
            "message": f"Analyzed {len(resources)} research resources",
        }

    def _search_news(self, search_query: str) -> Tuple[List[Dict], str]:
        try:
            response = requests.get(
                "https://newsapi.org/v2/everything",
                params={
                    "q": search_query,
                    "apiKey": self.news_api_key,
                    "pageSize": 8,
                    "language": "en",
                    "sortBy": "publishedAt",
                },
                timeout=6,
            )
            response.raise_for_status()
            articles = response.json().get("articles", [])
            normalized = []
            for article in articles:
                title = article.get("title")
                if not title:
                    continue
                normalized.append(
                    {
                        "title": title,
                        "source": (article.get("source") or {}).get("name", "NewsAPI"),
                        "url": article.get("url"),
                        "publishedAt": article.get("publishedAt") or self._iso(self._now_utc()),
                        "snippet": article.get("description") or "",
                    }
                )
            return normalized, ""
        except Exception as exc:
            return [], f"Search failed: {str(exc)[:160]}"

    def _synthetic_resources(self, ticker: str, user_query: str) -> List[Dict]:
        now = self._now_utc()
        return [
            {
                "title": f"{ticker} outlook mixed as macro uncertainty persists",
                "source": "Synthetic Research Feed",
                "url": "",
                "publishedAt": self._iso(now - timedelta(days=1)),
                "snippet": "Macro uncertainty and sector rotation keep sentiment balanced.",
            },
            {
                "title": f"{ticker} analyst revisions indicate cautious optimism",
                "source": "Synthetic Research Feed",
                "url": "",
                "publishedAt": self._iso(now - timedelta(days=3)),
                "snippet": "Some analysts revised targets upward while highlighting volatility.",
            },
            {
                "title": f"{ticker} valuation debate continues ahead of upcoming catalysts",
                "source": "Synthetic Research Feed",
                "url": "",
                "publishedAt": self._iso(now - timedelta(days=5)),
                "snippet": "Valuation remains debated by institutional investors.",
            },
            {
                "title": f"User query context: {user_query}",
                "source": "User Prompt",
                "url": "",
                "publishedAt": self._iso(now),
                "snippet": "Primary user intent incorporated into synthesis.",
            },
        ]

    def _dedupe_resources(self, resources: List[Dict]) -> List[Dict]:
        seen = set()
        deduped = []
        for item in resources:
            key = (item.get("url") or item.get("title", "")).strip().lower()
            if not key or key in seen:
                continue
            seen.add(key)
            deduped.append(item)
        return deduped

    def _timeline(self, resources: List[Dict], generated_at: datetime) -> Dict:
        dates = []
        for resource in resources:
            parsed = self._parse_iso(resource.get("publishedAt", ""))
            if parsed:
                dates.append(parsed)
        if not dates:
            dates = [generated_at]

        return {
            "from": self._iso(min(dates)),
            "to": self._iso(max(dates)),
            "generatedAt": self._iso(generated_at),
        }

    def _search_stats(self, attempts: List[Dict]) -> Dict:
        from_scratch = sum(1 for attempt in attempts if attempt["phase"] == "from_scratch")
        reiterations = sum(1 for attempt in attempts if attempt["phase"] == "reiteration")
        successful = sum(1 for attempt in attempts if attempt["status"] == "success")
        return {
            "searchesFromScratch": from_scratch,
            "reiterations": reiterations,
            "totalSearches": len(attempts),
            "successfulSearches": successful,
        }

    def _synthesis(self, labels: List[str]) -> Dict:
        bullish = labels.count("bullish")
        bearish = labels.count("bearish")
        neutral = labels.count("neutral")
        return {
            "bullish": bullish,
            "bearish": bearish,
            "neutral": neutral,
            "total": len(labels),
        }

    def _parse_iso(self, date_text: str) -> datetime | None:
        if not date_text:
            return None
        try:
            return datetime.fromisoformat(date_text.replace("Z", "+00:00"))
        except Exception:
            return None

    def _iso(self, dt: datetime) -> str:
        return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    def _now_utc(self) -> datetime:
        return datetime.now(timezone.utc)
