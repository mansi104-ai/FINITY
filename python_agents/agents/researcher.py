import os
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

import requests

try:
    from models.sentiment_nlp import aggregate_sentiment, label_sentiment
except ModuleNotFoundError:
    from python_agents.models.sentiment_nlp import aggregate_sentiment, label_sentiment


POLICY_KEYWORDS = {
    "tariff",
    "tariffs",
    "duty",
    "duties",
    "regulation",
    "regulations",
    "compliance",
    "export control",
    "sanction",
    "government",
    "policy",
    "sec",
    "federal register",
}


class ResearcherAgent:
    def __init__(self) -> None:
        self.news_api_key = os.getenv("NEWSAPI_KEY", "")
        self.enable_gov_policy_search = os.getenv("ENABLE_GOV_POLICY_SEARCH", "true").lower() == "true"
        self.policy_baseline_scan = os.getenv("POLICY_BASELINE_SCAN", "true").lower() == "true"
        self.max_news_results = int(os.getenv("RESEARCH_NEWS_RESULTS", "8"))
        self.max_gov_results = int(os.getenv("RESEARCH_GOV_RESULTS", "6"))

    def analyze(self, ticker: str, query: str) -> dict:
        start_perf = time.perf_counter()
        run_started = self._now_utc()

        intent = self._detect_intent(query)
        plan = self._build_search_plan(ticker=ticker, query=query, intent=intent)

        attempts: List[Dict] = []
        resources: List[Dict] = []

        for step in plan:
            search_started = self._now_utc()
            source = step["source"]
            search_query = step["query"]

            items, note, status = self._execute_search(source=source, search_query=search_query)
            resources.extend(items)

            attempts.append(
                {
                    "query": search_query,
                    "phase": step["phase"],
                    "source": source,
                    "status": status,
                    "resultCount": len(items),
                    "startedAt": self._iso(search_started),
                    "endedAt": self._iso(self._now_utc()),
                    "note": note,
                }
            )

        resources = self._dedupe_resources(resources)

        if not resources:
            resources = self._synthetic_resources(ticker=ticker, user_query=query, include_policy=intent["policy"])

        labels = []
        for resource in resources:
            text = f"{resource.get('title', '')} {resource.get('snippet', '')}".strip()
            sentiment_label = label_sentiment(text)
            resource["sentimentLabel"] = sentiment_label
            labels.append(sentiment_label)

        score, label, confidence = aggregate_sentiment(labels)
        synthesis = self._synthesis(labels)
        timeline = self._timeline(resources=resources, generated_at=run_started)
        search_stats = self._search_stats(attempts)
        policy_signals = self._policy_signals(resources)
        research_only_action = self._research_only_action(label=label, score=score, confidence=confidence)
        direct_answer = self._direct_answer(
            query=query,
            intent=intent,
            label=label,
            score=score,
            confidence=confidence,
            timeline=timeline,
            search_stats=search_stats,
            policy_signals=policy_signals,
            research_only_action=research_only_action,
        )

        reasoning = [
            (
                f"Collected {len(resources)} resources from timeline {timeline['from']} "
                f"to {timeline['to']}."
            ),
            (
                f"Searches run: {search_stats['totalSearches']} "
                f"({search_stats['searchesFromScratch']} from-scratch + {search_stats['reiterations']} reiterations)."
            ),
            (
                f"Sentiment votes: bullish={synthesis['bullish']}, bearish={synthesis['bearish']}, "
                f"neutral={synthesis['neutral']}."
            ),
            (
                f"Policy signal counts: tariffs={policy_signals['tariffMentions']}, "
                f"regulations={policy_signals['regulationMentions']}, "
                f"government resources={policy_signals['governmentResources']}."
            ),
            (
                f"Research-only verdict is {research_only_action.upper()} with "
                f"sentiment={label}, score={round(score, 3)}, confidence={round(confidence, 3)}."
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
            "queryIntent": [key for key, enabled in intent.items() if enabled],
            "directAnswer": direct_answer,
            "researchOnlyAction": research_only_action,
            "policySignals": policy_signals,
            "durationMs": int((time.perf_counter() - start_perf) * 1000),
            "message": f"Analyzed {len(resources)} resources across {search_stats['totalSearches']} searches",
        }

    def _build_search_plan(self, ticker: str, query: str, intent: Dict[str, bool]) -> List[Dict]:
        plan: List[Dict] = [
            {"source": "newsapi", "query": ticker, "phase": "from_scratch"},
            {"source": "newsapi", "query": f"{ticker} stock outlook", "phase": "reiteration"},
            {"source": "newsapi", "query": f"{ticker} earnings guidance", "phase": "reiteration"},
        ]

        should_run_policy_search = intent["policy"] or self.policy_baseline_scan
        if should_run_policy_search:
            plan.extend(
                [
                    {
                        "source": "federal_register",
                        "query": f"{ticker} securities regulation",
                        "phase": "from_scratch",
                    },
                    {
                        "source": "federal_register",
                        "query": query if intent["policy"] else f"{ticker} import tariff",
                        "phase": "reiteration",
                    },
                ]
            )

        return plan

    def _execute_search(self, source: str, search_query: str) -> Tuple[List[Dict], str, str]:
        if source == "newsapi":
            if not self.news_api_key:
                return [], "NEWSAPI_KEY missing; skipped NewsAPI.", "skipped"
            items, note = self._search_news(search_query)
            status = "success" if not note else "failed"
            return items, note if note else "NewsAPI search completed.", status

        if source == "federal_register":
            if not self.enable_gov_policy_search:
                return [], "Government policy search disabled by env.", "skipped"
            items, note = self._search_federal_register(search_query)
            status = "success" if not note else "failed"
            return items, note if note else "Federal Register search completed.", status

        return [], f"Unknown source '{source}'", "failed"

    def _search_news(self, search_query: str) -> Tuple[List[Dict], str]:
        try:
            response = requests.get(
                "https://newsapi.org/v2/everything",
                params={
                    "q": search_query,
                    "apiKey": self.news_api_key,
                    "pageSize": self.max_news_results,
                    "language": "en",
                    "sortBy": "publishedAt",
                },
                timeout=7,
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
                        "sourceType": "news",
                        "url": article.get("url"),
                        "publishedAt": article.get("publishedAt") or self._iso(self._now_utc()),
                        "snippet": article.get("description") or "",
                    }
                )
            return normalized, ""
        except Exception as exc:
            return [], f"NewsAPI failed: {str(exc)[:180]}"

    def _search_federal_register(self, search_query: str) -> Tuple[List[Dict], str]:
        try:
            response = requests.get(
                "https://www.federalregister.gov/api/v1/documents.json",
                params={
                    "conditions[term]": search_query,
                    "order": "newest",
                    "per_page": self.max_gov_results,
                },
                timeout=8,
            )
            response.raise_for_status()
            results = response.json().get("results", [])
            normalized = []
            for item in results:
                title = item.get("title")
                if not title:
                    continue
                agencies = item.get("agencies") or []
                agency_name = ", ".join(agency.get("name", "") for agency in agencies if agency.get("name"))
                normalized.append(
                    {
                        "title": title,
                        "source": agency_name if agency_name else "Federal Register",
                        "sourceType": "government",
                        "url": item.get("html_url"),
                        "publishedAt": item.get("publication_date") or self._iso(self._now_utc()),
                        "snippet": item.get("abstract") or item.get("type") or "",
                    }
                )
            return normalized, ""
        except Exception as exc:
            return [], f"Federal Register failed: {str(exc)[:180]}"

    def _synthetic_resources(self, ticker: str, user_query: str, include_policy: bool) -> List[Dict]:
        now = self._now_utc()
        resources = [
            {
                "title": f"{ticker} outlook mixed as macro uncertainty persists",
                "source": "Synthetic Research Feed",
                "sourceType": "internal",
                "url": "",
                "publishedAt": self._iso(now - timedelta(days=1)),
                "snippet": "Macro uncertainty and sector rotation keep sentiment balanced.",
            },
            {
                "title": f"{ticker} analyst revisions indicate cautious optimism",
                "source": "Synthetic Research Feed",
                "sourceType": "internal",
                "url": "",
                "publishedAt": self._iso(now - timedelta(days=3)),
                "snippet": "Some analysts revised targets upward while highlighting volatility.",
            },
            {
                "title": f"{ticker} valuation debate continues ahead of upcoming catalysts",
                "source": "Synthetic Research Feed",
                "sourceType": "internal",
                "url": "",
                "publishedAt": self._iso(now - timedelta(days=5)),
                "snippet": "Valuation remains debated by institutional investors.",
            },
            {
                "title": f"User query context: {user_query}",
                "source": "User Prompt",
                "sourceType": "internal",
                "url": "",
                "publishedAt": self._iso(now),
                "snippet": "Primary user intent incorporated into synthesis.",
            },
        ]

        if include_policy:
            resources.append(
                {
                    "title": f"Government policy watchlist for {ticker}: tariffs, export controls, and disclosures",
                    "source": "Synthetic Government Watch",
                    "sourceType": "government",
                    "url": "",
                    "publishedAt": self._iso(now - timedelta(days=2)),
                    "snippet": "No live government feed available; placeholder policy scan included.",
                }
            )

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

    def _synthesis(self, labels: List[str]) -> Dict:
        bullish = labels.count("bullish")
        bearish = labels.count("bearish")
        neutral = labels.count("neutral")
        return {"bullish": bullish, "bearish": bearish, "neutral": neutral, "total": len(labels)}

    def _policy_signals(self, resources: List[Dict]) -> Dict:
        tariff_mentions = 0
        regulation_mentions = 0
        government_resources = 0

        for resource in resources:
            text = f"{resource.get('title', '')} {resource.get('snippet', '')}".lower()
            if "tariff" in text or "duty" in text:
                tariff_mentions += 1
            if "regulation" in text or "rule" in text or "compliance" in text or "sec" in text:
                regulation_mentions += 1
            if resource.get("sourceType") == "government":
                government_resources += 1

        return {
            "tariffMentions": tariff_mentions,
            "regulationMentions": regulation_mentions,
            "governmentResources": government_resources,
        }

    def _research_only_action(self, label: str, score: float, confidence: float) -> str:
        if label == "bullish" and score >= 0.58 and confidence >= 0.56:
            return "buy"
        if label == "bearish" and score <= 0.42 and confidence >= 0.56:
            return "sell"
        return "hold"

    def _direct_answer(
        self,
        query: str,
        intent: Dict[str, bool],
        label: str,
        score: float,
        confidence: float,
        timeline: Dict,
        search_stats: Dict,
        policy_signals: Dict,
        research_only_action: str,
    ) -> str:
        answer = (
            f"Research sentiment is {label} (score={round(score, 3)}, confidence={round(confidence, 3)}), "
            f"so research-only action is {research_only_action.upper()}."
        )

        if intent["policy"]:
            answer += (
                f" Government-policy scan found {policy_signals['tariffMentions']} tariff signals and "
                f"{policy_signals['regulationMentions']} regulation signals from "
                f"{policy_signals['governmentResources']} government-sourced resources."
            )

        answer += (
            f" Evidence timeline ranges from {timeline['from']} to {timeline['to']}, "
            f"built from {search_stats['totalSearches']} searches."
        )

        if "current stock value" in query.lower() or "current price" in query.lower():
            answer += " For live price, rely on Analyst output (Version 2 or 4) with USE_LIVE_MARKET_DATA=true."

        return answer

    def _detect_intent(self, query: str) -> Dict[str, bool]:
        q = query.lower()
        return {
            "policy": any(term in q for term in POLICY_KEYWORDS),
            "price": "price" in q or "value" in q or "quote" in q,
            "buy_sell": "buy" in q or "sell" in q or "hold" in q,
            "risk": "risk" in q or "var" in q or "volatility" in q,
        }

    def _parse_iso(self, date_text: str) -> Optional[datetime]:
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
