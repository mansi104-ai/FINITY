"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getNews } from "../services/api";
import type { NewsArticle } from "../types";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return `${Math.floor(diff / 60000)}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const POPULAR = ["AAPL", "MSFT", "GOOGL", "TSLA", "NVDA", "AMZN", "META", "JPM"];
const CATEGORIES = [
  { value: "general", label: "Market" },
  { value: "crypto", label: "Crypto" },
  { value: "forex", label: "Forex" },
  { value: "merger", label: "M&A" },
] as const;

type Category = typeof CATEGORIES[number]["value"];

export default function News() {
  const params = useSearchParams();
  const initialTicker = params.get("ticker") ?? "";

  const [ticker, setTicker] = useState(initialTicker.toUpperCase());
  const [inputVal, setInputVal] = useState(initialTicker.toUpperCase());
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sentimentFilter, setSentimentFilter] = useState<"all" | "bullish" | "bearish" | "neutral">("all");
  const [category, setCategory] = useState<Category>("general");
  const [source, setSource] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    void getNews(ticker || undefined, ticker ? undefined : category)
      .then((res) => {
        setArticles(res.articles);
        setSource(res.source);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load news.");
        setArticles([]);
      })
      .finally(() => setLoading(false));
  }, [ticker, category]);

  function applyTicker() {
    const t = inputVal.trim().toUpperCase();
    setTicker(t);
  }

  const filtered = sentimentFilter === "all"
    ? articles
    : articles.filter((a) => a.sentiment === sentimentFilter);

  const bulls = articles.filter((a) => a.sentiment === "bullish").length;
  const bears = articles.filter((a) => a.sentiment === "bearish").length;
  const neutral = articles.filter((a) => a.sentiment === "neutral").length;
  const total = articles.length;

  const sentimentPct = total > 0 ? {
    bull: Math.round((bulls / total) * 100),
    bear: Math.round((bears / total) * 100),
    neutral: Math.round((neutral / total) * 100),
  } : null;

  function sentimentCls(s: NewsArticle["sentiment"]) {
    return s === "bullish" ? "findec-tag-green" : s === "bearish" ? "findec-tag-red" : "findec-tag-amber";
  }

  return (
    <section className="findec-minimal-page">
      <div className="findec-minimal-shell news-shell">
        <div className="news-header-row">
          <div>
            <p className="findec-kicker">Financial News</p>
            <h1 className="news-title">{ticker ? `${ticker} · ` : ""}Market News</h1>
          </div>
          {ticker && (
            <Link href={`/brief?ticker=${encodeURIComponent(ticker)}`} className="news-brief-link">
              ▶ AI Brief on {ticker}
            </Link>
          )}
        </div>

        {/* Search bar */}
        <div className="findec-panel news-search-panel">
          <div className="news-search-row">
            <input
              className="news-input"
              placeholder="Filter by ticker, e.g. AAPL"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter") applyTicker(); }}
            />
            <button className="news-search-btn" onClick={applyTicker}>Search</button>
            {ticker && (
              <button className="news-clear-btn" onClick={() => { setTicker(""); setInputVal(""); }}>
                All News
              </button>
            )}
          </div>
          <div className="news-popular">
            {POPULAR.map((t) => (
              <button
                key={t}
                className={`news-chip ${ticker === t ? "news-chip-active" : ""}`}
                onClick={() => { setTicker(t); setInputVal(t); }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Category tabs — only shown when no ticker selected */}
        {!ticker && (
          <div className="news-cat-tabs">
            {CATEGORIES.map((c) => (
              <button
                key={c.value}
                className={`news-cat-tab ${category === c.value ? "news-cat-tab-active" : ""}`}
                onClick={() => setCategory(c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        {/* Sentiment summary */}
        {!loading && sentimentPct && total > 0 && (
          <div className="findec-panel news-sentiment-panel">
            <p className="findec-kicker">Sentiment Breakdown · {total} articles</p>
            <div className="news-sentiment-bar">
              <div className="news-sentiment-bull" style={{ width: `${sentimentPct.bull}%` }} title={`Bullish ${sentimentPct.bull}%`} />
              <div className="news-sentiment-neutral" style={{ width: `${sentimentPct.neutral}%` }} title={`Neutral ${sentimentPct.neutral}%`} />
              <div className="news-sentiment-bear" style={{ width: `${sentimentPct.bear}%` }} title={`Bearish ${sentimentPct.bear}%`} />
            </div>
            <div className="news-sentiment-labels">
              <span className="findec-subline-up">Bullish {sentimentPct.bull}%</span>
              <span className="findec-subline-neutral">Neutral {sentimentPct.neutral}%</span>
              <span className="findec-subline-down">Bearish {sentimentPct.bear}%</span>
            </div>
          </div>
        )}

        {/* Sentiment filter tabs */}
        <div className="news-filter-tabs">
          {(["all", "bullish", "bearish", "neutral"] as const).map((f) => (
            <button
              key={f}
              className={`news-tab ${sentimentFilter === f ? "news-tab-active" : ""}`}
              onClick={() => setSentimentFilter(f)}
            >
              {f === "all" ? `All (${total})` : f === "bullish" ? `Bullish (${bulls})` : f === "bearish" ? `Bearish (${bears})` : `Neutral (${neutral})`}
            </button>
          ))}
        </div>

        {error && <div className="findec-panel news-error">{error}</div>}
        {loading && <p className="findec-kicker news-loading">Loading news…</p>}

        {!loading && !error && filtered.length === 0 && (
          <div className="findec-panel news-empty">
            <p>No articles found{ticker ? ` for ${ticker}` : ""}.</p>
            {ticker && (
              <button className="news-clear-btn news-empty-clear" onClick={() => { setTicker(""); setInputVal(""); }}>
                Show all news
              </button>
            )}
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="news-list">
            {filtered.map((article, i) => (
              <a
                key={i}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="findec-panel news-card"
              >
                {article.imageUrl && (
                  <img
                    src={article.imageUrl}
                    alt=""
                    className="news-card-img"
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                )}
                <div className="news-card-body">
                  <div className="news-card-top">
                    <span className={`findec-tag ${sentimentCls(article.sentiment)} news-card-tag`}>
                      {article.sentiment}
                    </span>
                    {article.category && article.category !== "general" && (
                      <span className="news-card-category">{article.category}</span>
                    )}
                    <span className="news-card-meta">
                      {article.source.name} · {timeAgo(article.publishedAt)}
                    </span>
                  </div>
                  <p className="news-card-title">{article.title}</p>
                  {article.description && (
                    <p className="news-card-desc">{article.description}</p>
                  )}
                  <span className="news-card-read">Read article →</span>
                </div>
              </a>
            ))}
          </div>
        )}

        {!loading && source && (
          <p className="news-source-note">Source: {source}</p>
        )}
      </div>
    </section>
  );
}
