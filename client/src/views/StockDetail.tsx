"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getMarketHistory, getNews, getStockDetail } from "../services/api";
import type { MarketHistory, NewsArticle, StockQuote } from "../types";

function toChartPoints(points: MarketHistory["points"], w: number, h: number): string {
  if (!points.length) return "";
  const closes = points.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = Math.max(max - min, 1);
  return points
    .map((p, i) => {
      const x = (i / Math.max(points.length - 1, 1)) * w;
      const y = h - ((p.close - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function posIn52w(price: number, low: number, high: number): number {
  if (high <= low) return 50;
  return Math.min(100, Math.max(0, ((price - low) / (high - low)) * 100));
}

function fmtCap(v: number): string {
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  return v.toLocaleString();
}

function fmtNum(v: number): string {
  const fracs = v >= 10000 ? 0 : 2;
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: fracs, maximumFractionDigits: fracs }).format(v);
}

function fmtVol(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return `${Math.floor(diff / 60000)}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function SignedPct({ v }: { v: number }) {
  const cls = v > 0 ? "findec-subline-up" : v < 0 ? "findec-subline-down" : "";
  return <span className={cls}>{v >= 0 ? "+" : ""}{v.toFixed(2)}%</span>;
}

function SentimentTag({ s }: { s: NewsArticle["sentiment"] }) {
  const cls = s === "bullish" ? "findec-tag-green" : s === "bearish" ? "findec-tag-red" : "findec-tag-amber";
  return <span className={`findec-tag ${cls} stk-news-tag`}>{s}</span>;
}

function valuationSignal(pe: number): string {
  if (pe < 12) return "Deep value territory";
  if (pe < 20) return "Fairly valued";
  if (pe < 35) return "Growth premium priced in";
  return "High multiple — strong growth required";
}

function betaSignal(beta: number): string {
  if (beta < 0.5) return "Very low volatility vs market";
  if (beta < 0.8) return "Defensive — lower swings";
  if (beta < 1.2) return "Market-like risk";
  if (beta < 1.8) return "Elevated volatility";
  return "High-beta — amplified market moves";
}

function momentumSignal(pct: number): string {
  if (pct >= 2) return "Strong upward momentum";
  if (pct >= 0.5) return "Mild positive session";
  if (pct >= -0.5) return "Flat — indecisive";
  if (pct >= -2) return "Mild selling pressure";
  return "Heavy distribution today";
}

export default function StockDetail({ ticker }: { ticker: string }) {
  const [stock, setStock] = useState<StockQuote | null>(null);
  const [history, setHistory] = useState<MarketHistory | null>(null);
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const [s, h] = await Promise.all([getStockDetail(ticker), getMarketHistory(ticker)]);
        setStock(s);
        setHistory(h);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load stock data.");
      }
    };
    void load();
  }, [ticker]);

  useEffect(() => {
    const loadNews = async () => {
      try {
        const res = await getNews(ticker);
        setNews(res.articles.slice(0, 6));
      } catch {
        setNews([]);
      }
    };
    void loadNews();
  }, [ticker]);

  const chartPoints = useMemo(
    () => (history ? toChartPoints(history.points, 760, 100) : ""),
    [history]
  );

  const isPositive = (history?.changePercent30d ?? 0) >= 0;

  return (
    <section className="findec-minimal-page">
      <div className="findec-minimal-shell">
        {/* Top nav */}
        <div className="stk-nav-row">
          <Link href="/markets" className="stk-back-link">← Markets</Link>
          <div className="stk-nav-actions">
            <Link href={`/compare?tickers=${encodeURIComponent(ticker)}`} className="stk-nav-btn">Compare</Link>
            <Link href={`/brief?ticker=${encodeURIComponent(ticker)}`} className="stk-nav-btn stk-nav-btn-primary">▶ AI Brief</Link>
          </div>
        </div>

        {error && (
          <div className="findec-panel finity-error-panel stk-error">{error}</div>
        )}
        {!stock && !error && (
          <p className="findec-kicker stk-loading">Loading {ticker}…</p>
        )}

        {stock && (
          <>
            {/* ── Hero header ── */}
            <article className="findec-panel stk-hero">
              <div className="stk-hero-main">
                <div className="stk-hero-left">
                  <p className="findec-kicker">{stock.exchange} · {stock.currency}</p>
                  <h1 className="stk-hero-name">{stock.name}</h1>
                  <span className="stk-hero-symbol">{stock.symbol}</span>
                </div>
                <div className="stk-hero-right">
                  <strong className="stk-hero-price">{fmtNum(stock.price)}</strong>
                  <div className="stk-hero-change">
                    <span className={stock.change >= 0 ? "findec-subline-up" : "findec-subline-down"}>
                      {stock.change >= 0 ? "+" : ""}{fmtNum(Math.abs(stock.change))}
                    </span>
                    <SignedPct v={stock.changePercent} />
                  </div>
                </div>
              </div>
              {(stock.volume != null || stock.avgVolume != null) && (
                <div className="stk-hero-vol">
                  {stock.volume != null && <span>Vol {fmtVol(stock.volume)}</span>}
                  {stock.avgVolume != null && <span>Avg {fmtVol(stock.avgVolume)}</span>}
                  {stock.volume != null && stock.avgVolume != null && (
                    <span className={stock.volume > stock.avgVolume ? "findec-subline-up" : "findec-subline-down"}>
                      {stock.volume > stock.avgVolume ? "above avg" : "below avg"}
                    </span>
                  )}
                  {stock.marketCap != null && <span className="stk-hero-cap">Mkt cap {fmtCap(stock.marketCap)}</span>}
                </div>
              )}
            </article>

            {/* ── 30-day chart ── */}
            <article className="findec-panel stk-chart-panel">
              <div className="stk-chart-top">
                <p className="findec-kicker">30-Day Price</p>
                {history && (
                  <div className="stk-chart-kpis">
                    <div><span>Return</span><SignedPct v={history.changePercent30d} /></div>
                    <div><span>High</span><strong>{fmtNum(history.high30d)}</strong></div>
                    <div><span>Low</span><strong>{fmtNum(history.low30d)}</strong></div>
                  </div>
                )}
              </div>
              <div className="stk-chart-svg-wrap">
                <svg viewBox="0 0 760 100" width="100%" aria-label="30 day chart">
                  {[25, 50, 75].map((y) => (
                    <line key={y} x1="0" y1={y} x2="760" y2={y} className="findec-chart-grid" />
                  ))}
                  {chartPoints && (
                    <polyline fill="none" stroke={isPositive ? "#72b92b" : "#cc5147"} strokeWidth="2" points={chartPoints} />
                  )}
                </svg>
              </div>
            </article>

            {/* ── Two-col: Valuation + Technicals ── */}
            <div className="stk-two-col">
              <article className="findec-panel stk-panel">
                <p className="findec-kicker">Valuation</p>
                <div className="stk-stat-grid">
                  {stock.marketCap != null && <div className="stk-stat"><span>Market Cap</span><strong>{fmtCap(stock.marketCap)}</strong></div>}
                  {stock.peRatio != null && <div className="stk-stat"><span>P/E (TTM)</span><strong>{stock.peRatio}</strong></div>}
                  {stock.forwardPE != null && <div className="stk-stat"><span>Forward P/E</span><strong>{stock.forwardPE}</strong></div>}
                  {stock.eps != null && <div className="stk-stat"><span>EPS (TTM)</span><strong>{stock.eps}</strong></div>}
                  {stock.epsForward != null && <div className="stk-stat"><span>Forward EPS</span><strong>{stock.epsForward}</strong></div>}
                  {stock.priceToBook != null && <div className="stk-stat"><span>P/B Ratio</span><strong>{stock.priceToBook}</strong></div>}
                  {stock.beta != null && <div className="stk-stat"><span>Beta</span><strong>{stock.beta}</strong></div>}
                  {stock.dividendYield != null && (
                    <div className="stk-stat"><span>Div Yield</span><strong>{stock.dividendYield.toFixed(2)}%</strong></div>
                  )}
                </div>
                {stock.peRatio != null && (
                  <p className="stk-signal-note">{valuationSignal(stock.peRatio)}</p>
                )}
              </article>

              <article className="findec-panel stk-panel">
                <p className="findec-kicker">Technicals</p>
                {stock.high52w != null && stock.low52w != null && (
                  <div className="stk-52w">
                    <span className="stk-stat-label">52-Week Range</span>
                    <div className="stk-52w-bar">
                      <span>{fmtNum(stock.low52w)}</span>
                      <div className="stk-range-track">
                        <div className="stk-range-dot" style={{ left: `${posIn52w(stock.price, stock.low52w, stock.high52w)}%` }} />
                      </div>
                      <span>{fmtNum(stock.high52w)}</span>
                    </div>
                    <p className="stk-52w-note">
                      {((stock.price - stock.low52w) / (stock.high52w - stock.low52w) * 100).toFixed(0)}% above 52W low
                    </p>
                  </div>
                )}
                <div className="stk-stat-grid stk-ma-grid">
                  {stock.ma50 != null && (
                    <div className="stk-stat">
                      <span>MA 50</span>
                      <strong>{fmtNum(stock.ma50)}</strong>
                      <em className={stock.price >= stock.ma50 ? "findec-subline-up" : "findec-subline-down"}>
                        {stock.price >= stock.ma50 ? "above ↑" : "below ↓"}
                      </em>
                    </div>
                  )}
                  {stock.ma200 != null && (
                    <div className="stk-stat">
                      <span>MA 200</span>
                      <strong>{fmtNum(stock.ma200)}</strong>
                      <em className={stock.price >= stock.ma200 ? "findec-subline-up" : "findec-subline-down"}>
                        {stock.price >= stock.ma200 ? "above ↑" : "below ↓"}
                      </em>
                    </div>
                  )}
                  {stock.ma50 != null && stock.ma200 != null && (
                    <div className="stk-stat stk-ma-cross">
                      <span>MA Cross</span>
                      <strong className={stock.ma50 > stock.ma200 ? "findec-subline-up" : "findec-subline-down"}>
                        {stock.ma50 > stock.ma200 ? "Golden cross ↑" : "Death cross ↓"}
                      </strong>
                    </div>
                  )}
                </div>
                {stock.beta != null && (
                  <p className="stk-signal-note">{betaSignal(stock.beta)}</p>
                )}
              </article>
            </div>

            {/* ── Investment signals ── */}
            <article className="findec-panel stk-signals-panel">
              <p className="findec-kicker">Investment Signals</p>
              <div className="stk-signals-grid">
                <div className="stk-signal-card">
                  <span>Today</span>
                  <strong>{momentumSignal(stock.changePercent)}</strong>
                  <SignedPct v={stock.changePercent} />
                </div>
                {stock.peRatio != null && (
                  <div className="stk-signal-card">
                    <span>Valuation</span>
                    <strong>{valuationSignal(stock.peRatio)}</strong>
                    <span className="stk-signal-dim">P/E {stock.peRatio}</span>
                  </div>
                )}
                {stock.beta != null && (
                  <div className="stk-signal-card">
                    <span>Risk</span>
                    <strong>{betaSignal(stock.beta)}</strong>
                    <span className="stk-signal-dim">β {stock.beta}</span>
                  </div>
                )}
                <div className="stk-signal-card">
                  <span>Income</span>
                  <strong>
                    {stock.dividendYield != null && stock.dividendYield > 0
                      ? `${stock.dividendYield.toFixed(2)}% yield`
                      : "No dividend"}
                  </strong>
                  <span className="stk-signal-dim">
                    {stock.dividendYield != null && stock.dividendYield > 0
                      ? stock.dividendYield >= 3 ? "Income-grade" : "Low dividend"
                      : "Growth-focused"}
                  </span>
                </div>
              </div>
            </article>

            {/* ── News ── */}
            {news.length > 0 && (
              <article className="findec-panel stk-news-panel">
                <div className="stk-news-header">
                  <p className="findec-kicker">Latest News · {ticker}</p>
                  <Link href={`/news?ticker=${encodeURIComponent(ticker)}`} className="stk-nav-btn">All news →</Link>
                </div>
                <div className="stk-news-list">
                  {news.map((article, i) => (
                    <a key={i} href={article.url} target="_blank" rel="noopener noreferrer" className="stk-news-row">
                      <div className="stk-news-body">
                        <SentimentTag s={article.sentiment} />
                        <p className="stk-news-title">{article.title}</p>
                        <span className="stk-news-meta">{article.source.name} · {timeAgo(article.publishedAt)}</span>
                      </div>
                    </a>
                  ))}
                </div>
              </article>
            )}

            {/* ── CTA ── */}
            <div className="stk-cta-row">
              <Link href={`/brief?ticker=${encodeURIComponent(ticker)}`} className="stk-cta-primary">
                ▶ Run AI Brief on {ticker}
              </Link>
              <Link href={`/compare?tickers=${encodeURIComponent(ticker)}`} className="stk-cta-ghost">
                Compare →
              </Link>
              <Link href="/screener" className="stk-cta-ghost">
                Screener →
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
