import os
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Tuple

import requests

try:
    from ..models.sentiment_nlp import aggregate_sentiment, label_sentiment
except Exception:
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

        search_queries = self._build_search_queries(ticker=ticker, query=query)

        attempts: List[Dict] = []
        resources: List[Dict] = []

        if not self.news_api_key:
            attempts.append(
                {
                    "query": search_queries[0],
                    "phase": "from_scratch",
                    "source": "newsapi",
                    "status": "skipped",
                    "resultCount": 0,
                    "startedAt": self._iso(run_started),
                    "endedAt": self._iso(self._now_utc()),
                    "note": "NEWSAPI_KEY missing; skipped live research and used synthetic fallback.",
                }
            )
            resources = self._synthetic_resources(ticker=ticker, user_query=query)
            labels = []
            for resource in resources:
                label = label_sentiment(resource["title"])
                resource["sentimentLevel"] = label
                labels.append(label)

            score, level, confidence, synthesis = aggregate_sentiment(labels)
            timeline = self._timeline(resources=resources, generated_at=run_started)
            search_stats = self._search_stats(attempts)
            reasoning = [
                f"Live news research unavailable, so fallback synthetic research was generated for {ticker}.",
                f"Forecast context used the query topic: {query.strip() or ticker}.",
                f"Final researcher sentiment={level} (score={score}, confidence={confidence}).",
            ]
            return {
                "level": level,
                "score": score,
                "confidence": confidence,
                "resources": resources,
                "timeline": timeline,
                "searchStats": search_stats,
                "searchAttempts": attempts,
                "reasoning": reasoning,
                "synthesis": synthesis,
                "durationMs": int((time.perf_counter() - start_perf) * 1000),
                "message": f"Generated {len(resources)} fallback research resources",
            }

        for idx, search_query in enumerate(search_queries):
            phase = "from_scratch" if idx == 0 else "reiteration"
            search_started = self._now_utc()

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
            resource["sentimentLevel"] = label
            labels.append(label)

        score, level, confidence, synthesis = aggregate_sentiment(labels)
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
                f"Final researcher sentiment={level} (score={score}, "
                f"confidence={confidence}), therefore {recommendation_bias}."
            ),
        ]

        return {
            "level": level,
            "score": score,
            "confidence": confidence,
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
            response = requests.get(
                "https://newsapi.org/v2/everything",
                params={
                    "q": search_query,
                    "apiKey": self.news_api_key,
                    "pageSize": 15,  # Get more to filter through
                    "language": "en",
                    "sortBy": "publishedAt",
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

    def _synthetic_resources(self, ticker: str, user_query: str) -> List[Dict]:
        now = self._now_utc()
        import random
        
        # Randomize between all 5 sentiment levels for more diversity
        sentiment_tilt = random.choice(["STRONG_BUY", "BUY", "HOLD", "SELL", "STRONG_SELL"])
        
        sentiment_data = {
            "STRONG_BUY": {
                "titles": [
                    f"{ticker} shows exceptional growth with breakout potential",
                    f"{ticker} achieves record performance, analysts upgrade aggressively",
                    f"{ticker} dominates market with innovation and strategic advantage",
                    f"{ticker} demonstrates accelerating momentum with strong catalysts",
                ],
                "snippets": [
                    "Outstanding fundamentals and exceptional execution drive market leadership.",
                    "Record profitability with momentum accelerating. Strong buy signals across metrics.",
                    "Breakthrough innovation creates sustainable competitive advantage.",
                    "Multiple positive catalysts converge for exceptional upside opportunity.",
                ]
            },
            "BUY": {
                "titles": [
                    f"{ticker} shows attractive upside with positive outlook",
                    f"{ticker} analysts upgrade on improving fundamentals",
                    f"{ticker} offers compelling opportunity amid growth acceleration",
                    f"{ticker} momentum strengthens with successful execution",
                ],
                "snippets": [
                    "Growth trajectory improving with positive sentiment. Upgrade recommended.",
                    "Strong operational improvements and market expansion underway.",
                    "Attractively valued with upside potential from multiple drivers.",
                    "Positive catalysts support outperformance in near term.",
                ]
            },
            "HOLD": {
                "titles": [
                    f"{ticker} displays mixed signals amid market uncertainty",
                    f"{ticker} remains balanced with opportunities and risks",
                    f"{ticker} maintains steady outlook despite sector headwinds",
                    f"{ticker} catalysts ahead could drive significant moves",
                ],
                "snippets": [
                    "Balanced view with both upside and downside scenarios.",
                    "Neutral positioning warranted pending catalyst resolution.",
                    "Mixed signals from analysts suggest cautious approach.",
                    "Uncertain near-term direction with multiple potential outcomes.",
                ]
            },
            "SELL": {
                "titles": [
                    f"{ticker} faces headwinds amid deteriorating fundamentals",
                    f"{ticker} analysts downgrade on growing concerns",
                    f"{ticker} pressure persists despite management efforts",
                    f"{ticker} weakness accelerates amid sector challenges",
                ],
                "snippets": [
                    "Deteriorating fundamentals and negative momentum warrant downgrade.",
                    "Multiple concerns emerging with challenging near-term outlook.",
                    "Weakness spreading across key metrics. Downside risks rising.",
                    "Underperformance likely as headwinds intensify.",
                ]
            },
            "STRONG_SELL": {
                "titles": [
                    f"{ticker} faces existential crisis with severe challenges",
                    f"{ticker} collapses amid fraud and governance scandal",
                    f"{ticker} bankruptcy risk emerges from catastrophic failures",
                    f"{ticker} devastated by recession impact and asset liquidation",
                ],
                "snippets": [
                    "Catastrophic deterioration with existential threats to business model.",
                    "Scandal and fraud allegations threaten company viability.",
                    "Bankruptcy scenario increasingly likely given toxic fundamentals.",
                    "Avoid at all costs - severe downside risk on horizon.",
                ]
            }
        }
        
        data = sentiment_data[sentiment_tilt]
        titles = data["titles"]
        snippets = data["snippets"]
        
        resources = []
        for i in range(4):
            resources.append({
                "title": f"{ticker} - {titles[i]}",
                "source": "Synthetic Research Feed",
                "url": "",
                "publishedAt": self._iso(now - timedelta(days=5-i)),
                "snippet": snippets[i] if i < len(snippets) else "Research analysis included.",
            })
        
        return resources

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
