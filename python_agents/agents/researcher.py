import os
import time
import math
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Tuple

import requests

DECAY_LAMBDA = 0.85
BULLISH_THRESHOLD = 0.2
BEARISH_THRESHOLD = -0.2

try:
    from ..models.sentiment_nlp import aggregate_sentiment, label_sentiment
    from ..models import finbert_sentiment
except Exception:
    try:
        from models.sentiment_nlp import aggregate_sentiment, label_sentiment
        from models import finbert_sentiment
    except ModuleNotFoundError:
        from python_agents.models.sentiment_nlp import aggregate_sentiment, label_sentiment
        from python_agents.models import finbert_sentiment


def _classify_sentiment(text: str) -> str:
    """FinBERT first (local model, no API key); lexicon fallback if the
    model isn't available (not installed, couldn't download, etc.)."""
    finbert_label = finbert_sentiment.classify(text)
    if finbert_label is not None:
        return finbert_label
    return label_sentiment(text)


class ResearcherAgent:
    """Real multi-provider research pipeline, NO synthetic fallback:

        NewsAPI (primary) -> Finnhub company-news (secondary)
            -> explicit "unavailable" result

    If both live providers fail or return nothing usable, this returns a
    degraded, clearly-labeled result (dataAvailable=False, confidence=0.0,
    empty resources) instead of fabricating articles. Downstream agents
    (crew.py) must treat dataAvailable=False as "no evidence", not as a
    neutral HOLD signal to quietly average in.
    """

    def __init__(self) -> None:
        self.news_api_key = os.getenv("NEWS_API_KEY", os.getenv("NEWSAPI_KEY", ""))
        self.finnhub_api_key = os.getenv("FINNHUB_API_KEY", "")

    def analyze(self, ticker: str, query: str) -> dict:
        start_perf = time.perf_counter()
        run_started = self._now_utc()
        horizon_context = self._query_horizon_context(query)

        search_queries = self._build_search_queries(ticker=ticker, query=query)

        attempts: List[Dict] = []
        resources: List[Dict] = []

        if self.news_api_key:
            for idx, search_query in enumerate(search_queries):
                phase = "from_scratch" if idx == 0 else "reiteration"
                search_started = self._now_utc()
                items, error_note = self._search_news(search_query, horizon_context=horizon_context)
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
        else:
            attempts.append(
                {
                    "query": search_queries[0],
                    "phase": "from_scratch",
                    "source": "newsapi",
                    "status": "skipped",
                    "resultCount": 0,
                    "startedAt": self._iso(run_started),
                    "endedAt": self._iso(self._now_utc()),
                    "note": "NEWSAPI_KEY not set; skipped.",
                }
            )

        resources = self._dedupe_resources(resources)

        # Secondary provider: only queried if NewsAPI produced nothing
        # usable (missing key, rate-limited, or genuinely no results).
        if not resources:
            if self.finnhub_api_key:
                search_started = self._now_utc()
                items, error_note = self._search_news_finnhub(ticker=ticker, horizon_context=horizon_context)
                resources.extend(items)
                attempts.append(
                    {
                        "query": f"finnhub:{ticker}",
                        "phase": "reiteration",
                        "source": "finnhub",
                        "status": "success" if not error_note else "failed",
                        "resultCount": len(items),
                        "startedAt": self._iso(search_started),
                        "endedAt": self._iso(self._now_utc()),
                        "note": error_note if error_note else "Search completed.",
                    }
                )
                resources = self._dedupe_resources(resources)
            else:
                attempts.append(
                    {
                        "query": f"finnhub:{ticker}",
                        "phase": "reiteration",
                        "source": "finnhub",
                        "status": "skipped",
                        "resultCount": 0,
                        "startedAt": self._iso(self._now_utc()),
                        "endedAt": self._iso(self._now_utc()),
                        "note": "FINNHUB_API_KEY not set; skipped.",
                    }
                )

        if not resources:
            timeline = self._timeline(resources=[], generated_at=run_started)
            search_stats = self._search_stats(attempts)
            reasoning = [
                f"No usable news was returned by NewsAPI or Finnhub for {ticker}; no synthetic research was generated.",
                "Sentiment is reported as neutral with zero confidence -- this should be treated as missing evidence, not as a bullish/bearish signal.",
            ]
            return {
                "level": "HOLD",
                "score": 0.5,
                "confidence": 0.0,
                "dataAvailable": False,
                "resources": [],
                "timeline": timeline,
                "searchStats": search_stats,
                "searchAttempts": attempts,
                "reasoning": reasoning,
                "synthesis": None,
                "durationMs": int((time.perf_counter() - start_perf) * 1000),
                "message": f"No live news available for {ticker}; returned degraded result instead of fabricated data.",
            }

        labels = []
        weights = []
        for resource in resources:
            label = _classify_sentiment(f"{resource['title']} {resource.get('snippet', '')}")
            relevance = self._resource_relevance(resource=resource, ticker=ticker, query=query)
            influence, recency_weight, age_hours = self._resource_influence(
                resource=resource,
                relevance=relevance,
                horizon_context=horizon_context,
            )
            resource["sentimentLevel"] = label
            resource["relevanceScore"] = round(relevance, 3)
            resource["influenceWeight"] = round(influence, 3)
            resource["recencyWeight"] = round(recency_weight, 3)
            resource["ageHours"] = round(age_hours, 1)
            labels.append(label)
            weights.append(influence)

        score, level, confidence, synthesis = aggregate_sentiment(labels, weights)
        timeline = self._timeline(resources=resources, generated_at=run_started)
        search_stats = self._search_stats(attempts)

        recommendation_bias = (
            "research bias suggests STRONG BUY"
            if level == "STRONG_BUY"
            else "research bias suggests BUY"
            if level == "BUY"
            else "research bias suggests HOLD/WAIT"
            if level == "HOLD"
            else "research bias suggests SELL"
            if level == "SELL"
            else "research bias suggests STRONG SELL"
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
                f"Sentiment distribution: STRONG_BUY={synthesis['strong_buy']}, "
                f"BUY={synthesis['buy']}, HOLD={synthesis['hold']}, "
                f"SELL={synthesis['sell']}, STRONG_SELL={synthesis['strong_sell']}."
            ),
            (
                f"Weighted article influence used exact published timestamps, query-horizon recency decay, relevance, and source quality."
            ),
            (
                f"Audited thresholds: bullish if S > {BULLISH_THRESHOLD}, bearish if S < {BEARISH_THRESHOLD}, decay lambda={DECAY_LAMBDA}."
            ),
            (
                f"Final researcher sentiment={level} (weighted score={score}, "
                f"confidence={confidence}), therefore {recommendation_bias}."
            ),
        ]

        return {
            "level": level,
            "score": score,
            "confidence": confidence,
            "dataAvailable": True,
            "resources": resources,
            "timeline": timeline,
            "searchStats": search_stats,
            "searchAttempts": attempts,
            "reasoning": reasoning,
            "synthesis": synthesis,
            "durationMs": int((time.perf_counter() - start_perf) * 1000),
            "message": f"Analyzed {len(resources)} research resources",
        }

    def _search_news(self, search_query: str, horizon_context: Dict | None = None) -> Tuple[List[Dict], str]:
        # Keywords to filter for financial/price-related content
        FINANCIAL_KEYWORDS = {
            "price", "stock", "trading", "market", "earnings", "revenue", "profit",
            "forecast", "outlook", "target", "analyst", "rating", "upgrade", "downgrade",
            "investor", "fund", "portfolio", "performance", "financial", "quarter", "q1", "q2", "q3", "q4",
            "guidance", "dividend", "share", "trade", "bull", "bear", "volatility", "index", "rally"
        }
        
        # Keywords to exclude (non-financial noise)
        EXCLUSION_KEYWORDS = {
            "olympic", "medal", "sports", "game", "tournament", "championship", "nfl", "nba", "nhl",
            "entertainment", "celebrity", "award", "music", "movie", "fashion", "beauty",
            "record label", "gold medal", "gold digger", "golden retriever", "minecraft", "wedding"
        }
        
        try:
            horizon_context = horizon_context or self._query_horizon_context("")
            window_start = self._now_utc() - timedelta(days=horizon_context["search_window_days"])
            response = requests.get(
                "https://newsapi.org/v2/everything",
                params={
                    "q": search_query,
                    "apiKey": self.news_api_key,
                    "pageSize": 15,  # Get more to filter through
                    "language": "en",
                    "sortBy": "publishedAt",
                    "from": self._iso(window_start),
                },
                timeout=6,
            )
            response.raise_for_status()
            data = response.json()
            
            # Check for API errors in response
            if data.get("status") == "error":
                return [], f"API Error: {data.get('message', 'Unknown error')}"
            
            articles = data.get("articles", [])
            if not articles:
                return [], f"No articles found for query: {search_query}"
            
            normalized = []
            for article in articles:
                title = article.get("title", "").lower()
                snippet = article.get("description", "").lower()
                content = f"{title} {snippet}"
                
                # Skip articles with exclusion keywords
                if any(keyword in content for keyword in EXCLUSION_KEYWORDS):
                    continue
                
                # Only include articles with financial keywords
                if not any(keyword in content for keyword in FINANCIAL_KEYWORDS):
                    continue
                
                article_title = article.get("title")
                if not article_title:
                    continue
                    
                normalized.append(
                    {
                        "title": article_title,
                        "source": (article.get("source") or {}).get("name", "NewsAPI"),
                        "url": article.get("url"),
                        "publishedAt": article.get("publishedAt") or self._iso(self._now_utc()),
                        "snippet": article.get("description") or "",
                    }
                )
            
            if not normalized:
                return [], f"No relevant financial articles found (filtered for quality)"
            
            return normalized, ""
        except requests.exceptions.HTTPError as exc:
            err_msg = f"HTTP {exc.response.status_code}: {exc.response.reason}"
            if exc.response.status_code == 401:
                err_msg = "Invalid/expired API key (401). Verify NEWSAPI_KEY in .env.local"
            elif exc.response.status_code == 429:
                err_msg = "Rate limit exceeded (429). Please try again later."
            return [], err_msg
        except Exception as exc:
            return [], f"Search error: {str(exc)[:120]}"

    def _build_search_queries(self, ticker: str, query: str) -> List[str]:
        normalized_query = " ".join(query.strip().split())
        if not normalized_query:
            return [
                f"{ticker} stock price trading market",
                f"{ticker} price forecast outlook investor",
                f"{ticker} earnings financial performance guidance",
            ]

        macro_terms = {"tariff", "tariffs", "fed", "inflation", "opec", "sanction", "rates", "yield", "crude", "oil", "gold"}
        query_lower = normalized_query.lower()
        if any(term in query_lower for term in macro_terms):
            return [
                f"{ticker} {normalized_query}",
                f"{ticker} macro impact market reaction",
            ]

        return [
            f"{ticker} {normalized_query}",
            f"{ticker} price forecast outlook investor",
            f"{ticker} earnings financial performance guidance",
        ]

    def _search_news_finnhub(self, ticker: str, horizon_context: Dict | None = None) -> Tuple[List[Dict], str]:
        """Finnhub's /company-news endpoint, used as the second real
        provider when NewsAPI is missing/failed/empty. Requires
        FINNHUB_API_KEY (free tier available)."""
        try:
            horizon_context = horizon_context or self._query_horizon_context("")
            window_start = self._now_utc() - timedelta(days=horizon_context["search_window_days"])
            response = requests.get(
                "https://finnhub.io/api/v1/company-news",
                params={
                    "symbol": ticker.upper(),
                    "from": window_start.date().isoformat(),
                    "to": self._now_utc().date().isoformat(),
                    "token": self.finnhub_api_key,
                },
                timeout=6,
            )
            response.raise_for_status()
            articles = response.json()
            if not isinstance(articles, list) or not articles:
                return [], f"No Finnhub articles found for {ticker}"

            normalized = []
            for article in articles[:15]:
                headline = article.get("headline")
                if not headline:
                    continue
                published_ts = article.get("datetime")
                published_at = (
                    datetime.fromtimestamp(published_ts, tz=timezone.utc) if published_ts else self._now_utc()
                )
                normalized.append(
                    {
                        "title": headline,
                        "source": article.get("source", "Finnhub"),
                        "url": article.get("url", ""),
                        "publishedAt": self._iso(published_at),
                        "snippet": article.get("summary", ""),
                    }
                )
            if not normalized:
                return [], "Finnhub returned articles with no usable headline"
            return normalized, ""
        except requests.exceptions.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else None
            if status == 401:
                return [], "Invalid/expired Finnhub API key (401). Verify FINNHUB_API_KEY."
            if status == 429:
                return [], "Finnhub rate limit exceeded (429)."
            return [], f"Finnhub HTTP error: {status}"
        except Exception as exc:
            return [], f"Finnhub search error: {str(exc)[:120]}"

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

    def _resource_relevance(self, resource: Dict, ticker: str, query: str) -> float:
        query_tokens = set(self._tokens(f"{ticker} {query}"))
        resource_tokens = self._tokens(f"{resource.get('title', '')} {resource.get('snippet', '')}")
        if not query_tokens:
            return 0.45

        overlap = len([token for token in resource_tokens if token in query_tokens])
        overlap_score = overlap / max(min(len(query_tokens), 8), 1)
        sentiment_alignment = 0.08 if resource.get("sentimentLevel") in {"BUY", "STRONG_BUY", "SELL", "STRONG_SELL"} else 0.03
        return max(0.12, min(0.98, overlap_score * 0.72 + sentiment_alignment))

    def _resource_influence(self, resource: Dict, relevance: float, horizon_context: Dict) -> Tuple[float, float, float]:
        published = self._parse_iso(resource.get("publishedAt", ""))
        age_hours = float(horizon_context["stale_after_hours"])
        if published:
            age_hours = max(0.0, (self._now_utc() - published).total_seconds() / 3600)

        normalized_age = age_hours / max(horizon_context["half_life_hours"], 1.0)
        recency_score = 0.32 + 0.88 * (DECAY_LAMBDA ** normalized_age)
        if age_hours <= 24:
            recency_score += horizon_context["fresh_bonus"]
        elif age_hours > horizon_context["stale_after_hours"]:
            recency_score *= horizon_context["stale_penalty"]

        source_score = self._source_quality(resource.get("source", ""))
        sentiment_intensity = 1.08 if resource.get("sentimentLevel") in {"STRONG_BUY", "STRONG_SELL"} else 1.0
        influence = max(0.1, min(2.2, relevance * recency_score * source_score * sentiment_intensity))
        return influence, recency_score, age_hours

    def _query_horizon_context(self, query: str) -> Dict:
        text = (query or "").lower()
        if any(term in text for term in {"today", "intraday", "right now", "by close"}):
            return {
                "label": "today",
                "half_life_hours": 18.0,
                "stale_after_hours": 60.0,
                "search_window_days": 4,
                "fresh_bonus": 0.14,
                "stale_penalty": 0.5,
            }
        if any(term in text for term in {"tomorrow", "next session"}):
            return {
                "label": "next 1-2 sessions",
                "half_life_hours": 28.0,
                "stale_after_hours": 84.0,
                "search_window_days": 5,
                "fresh_bonus": 0.1,
                "stale_penalty": 0.56,
            }
        if any(term in text for term in {"this week", "next week", "weekly"}):
            return {
                "label": "1 trading week",
                "half_life_hours": 72.0,
                "stale_after_hours": 240.0,
                "search_window_days": 10,
                "fresh_bonus": 0.06,
                "stale_penalty": 0.68,
            }
        if any(term in text for term in {"this month", "next month", "30 days"}):
            return {
                "label": "1 trading month",
                "half_life_hours": 168.0,
                "stale_after_hours": 720.0,
                "search_window_days": 30,
                "fresh_bonus": 0.03,
                "stale_penalty": 0.8,
            }
        return {
            "label": "short-term",
            "half_life_hours": 48.0,
            "stale_after_hours": 168.0,
            "search_window_days": 7,
            "fresh_bonus": 0.08,
            "stale_penalty": 0.62,
        }

    def _source_quality(self, source_name: str) -> float:
        trusted = {
            "reuters": 1.2,
            "bloomberg": 1.2,
            "wall street journal": 1.16,
            "financial times": 1.16,
            "cnbc": 1.08,
            "marketwatch": 1.04,
            "newsapi": 0.98,
            "synthetic research feed": 0.82,
        }
        normalized = source_name.strip().lower()
        for key, value in trusted.items():
            if key in normalized:
                return value
        return 1.0

    def _tokens(self, text: str) -> List[str]:
        stop_words = {
            "the", "and", "for", "with", "that", "this", "from", "what", "when", "where",
            "which", "will", "stock", "price", "today", "should", "would", "could",
        }
        raw = [token.strip(".,!?;:\"'()[]{}$#@!~").lower() for token in text.split()]
        return [token for token in raw if len(token) > 2 and token not in stop_words]

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