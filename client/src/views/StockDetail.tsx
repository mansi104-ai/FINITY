"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getAnalystRecommendations, getMarketHistory, getNews, getStockDetail } from "../services/api";
import type { AnalystRecommendation, MarketHistory, NewsArticle, StockQuote } from "../types";
import AdvancedChart from "../components/AdvancedChart";
import InfoTip from "../components/InfoTip";
import { buildScorecard, scoreBand } from "../lib/scorecard";

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

type ExtLink = { label: string; url: string; tag: string };

// Research sites that resolve consistently for ANY company via a templated URL
// (no per-company id needed). Market-aware: Indian (.NS/.BO), UK (.L), and global.
function externalResearchLinks(symbol: string, name: string): ExtLink[] {
  const dot = symbol.lastIndexOf(".");
  const suffix = dot > -1 ? symbol.slice(dot) : "";
  const base = dot > -1 ? symbol.slice(0, dot) : symbol;
  const q = encodeURIComponent(name || symbol);

  // Universal — work for every market.
  const universal: ExtLink[] = [
    { label: "Yahoo Finance", url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`, tag: "Quote" },
    { label: "Google News", url: `https://news.google.com/search?q=${q}%20stock`, tag: "News" },
  ];

  // India (NSE/BSE)
  if (suffix === ".NS" || suffix === ".BO") {
    const tvEx = suffix === ".BO" ? "BSE" : "NSE";
    const saEx = suffix === ".BO" ? "bse" : "nse";
    return [
      { label: "Screener.in", url: `https://www.screener.in/company/${encodeURIComponent(base)}/`, tag: "Fundamentals" },
      { label: "Tickertape", url: `https://www.tickertape.in/search?q=${q}`, tag: "Analysis" },
      { label: "Trendlyne", url: `https://trendlyne.com/equity/search/?q=${q}`, tag: "Forecasts" },
      { label: "StockAnalysis", url: `https://stockanalysis.com/quote/${saEx}/${encodeURIComponent(base)}/`, tag: "Financials" },
      { label: "NSE India", url: `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(base)}`, tag: "Exchange" },
      { label: "TradingView", url: `https://www.tradingview.com/symbols/${tvEx}-${encodeURIComponent(base)}/`, tag: "Charts" },
      ...universal,
    ];
  }

  // UK (LSE)
  if (suffix === ".L") {
    return [
      { label: "StockAnalysis", url: `https://stockanalysis.com/quote/lon/${encodeURIComponent(base)}/`, tag: "Financials" },
      { label: "TradingView", url: `https://www.tradingview.com/symbols/LSE-${encodeURIComponent(base)}/`, tag: "Charts" },
      { label: "FT Markets", url: `https://markets.ft.com/data/search?query=${q}`, tag: "News" },
      ...universal,
    ];
  }

  // US / default
  return [
    { label: "StockAnalysis", url: `https://stockanalysis.com/stocks/${encodeURIComponent(base)}/`, tag: "Financials" },
    { label: "Finviz", url: `https://finviz.com/quote.ashx?t=${encodeURIComponent(base)}`, tag: "Snapshot" },
    { label: "TradingView", url: `https://www.tradingview.com/symbols/${encodeURIComponent(base)}/`, tag: "Charts" },
    { label: "MarketWatch", url: `https://www.marketwatch.com/investing/stock/${encodeURIComponent(base.toLowerCase())}`, tag: "Quote" },
    { label: "SEC EDGAR", url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=${encodeURIComponent(base)}&type=10-K`, tag: "Filings" },
    { label: "Seeking Alpha", url: `https://seekingalpha.com/symbol/${encodeURIComponent(base)}`, tag: "Analysis" },
    ...universal,
  ];
}

export default function StockDetail({ ticker }: { ticker: string }) {
  const [stock, setStock] = useState<StockQuote | null>(null);
  const [history, setHistory] = useState<MarketHistory | null>(null);
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [recommendations, setRecommendations] = useState<AnalystRecommendation[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      const [stockResult, historyResult] = await Promise.allSettled([getStockDetail(ticker), getMarketHistory(ticker)]);

      if (stockResult.status === "fulfilled") {
        setStock(stockResult.value);
      } else {
        setStock(null);
      }

      if (historyResult.status === "fulfilled") {
        setHistory(historyResult.value);
      } else {
        setHistory(null);
      }

      // Only the quote is required to render the detail page. A history failure
      // (e.g. Yahoo blocking a ticker) must NOT blank the page — the advanced
      // candle chart and fundamentals still load, so we degrade gracefully.
      if (stockResult.status === "rejected") {
        setError(stockResult.reason instanceof Error ? stockResult.reason.message : "Failed to load stock data.");
        return;
      }

      setError("");
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

  useEffect(() => {
    const loadRecs = async () => {
      try {
        const res = await getAnalystRecommendations(ticker);
        setRecommendations(res.recommendations);
      } catch { /* not available for all tickers */ }
    };
    void loadRecs();
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

            {/* ── Findec Scorecard ── */}
            {(() => {
              const card = buildScorecard(stock);
              if (!card) return null;
              const band = scoreBand(card.overall);
              return (
                <article className="findec-panel stk-scorecard">
                  <div className="stk-sc-head">
                    <div>
                      <p className="findec-kicker">Findec Scorecard</p>
                      <span className="stk-sc-sub">Multi-factor read · {stock.symbol}</span>
                    </div>
                    <div className={`stk-sc-overall ${band.cls}`}>
                      <strong>{card.overall}</strong>
                      <span>/ 100 · {band.label}</span>
                    </div>
                  </div>
                  <div className="stk-sc-dims">
                    {card.dims.map((d) => {
                      const b = scoreBand(d.score);
                      return (
                        <div key={d.key} className="stk-sc-dim">
                          <div className="stk-sc-dim-top">
                            <span>{d.label}</span>
                            <strong className={b.cls}>{d.score}</strong>
                          </div>
                          <div className="stk-sc-bar"><div className={`stk-sc-fill ${b.cls}`} style={{ width: `${d.score}%` }} /></div>
                          <span className="stk-sc-note">{d.note}</span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="stk-sc-foot">Computed from live fundamentals — not a recommendation. Higher is more favourable.</p>
                </article>
              );
            })()}

            {/* ── External research links ── */}
            <article className="findec-panel stk-links-panel">
              <p className="findec-kicker">Research this stock elsewhere</p>
              <div className="stk-links-grid">
                {externalResearchLinks(stock.symbol, stock.name).map((l) => (
                  <a key={l.label} href={l.url} target="_blank" rel="noopener noreferrer" className="stk-link-chip">
                    <span className="stk-link-label">{l.label}</span>
                    <span className="stk-link-tag">{l.tag}</span>
                    <span className="stk-link-arrow" aria-hidden="true">↗</span>
                  </a>
                ))}
              </div>
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

            {/* ── Advanced chart (candlesticks, RSI, MACD, Bollinger) ── */}
            {!stock.isIndex && <AdvancedChart ticker={ticker} />}

            {/* ── Two-col: Valuation + Technicals ── */}
            <div className="stk-two-col">
              <article className="findec-panel stk-panel">
                <p className="findec-kicker">Valuation</p>
                <div className="stk-stat-grid">
                  {stock.marketCap != null && <div className="stk-stat"><span>Market Cap <InfoTip term="marketCap" /></span><strong>{fmtCap(stock.marketCap)}</strong></div>}
                  {stock.peRatio != null && <div className="stk-stat"><span>P/E (TTM) <InfoTip term="peRatio" /></span><strong>{stock.peRatio}</strong></div>}
                  {stock.forwardPE != null && <div className="stk-stat"><span>Forward P/E <InfoTip term="forwardPE" /></span><strong>{stock.forwardPE}</strong></div>}
                  {stock.eps != null && <div className="stk-stat"><span>EPS (TTM) <InfoTip term="eps" /></span><strong>{stock.eps}</strong></div>}
                  {stock.epsForward != null && <div className="stk-stat"><span>Forward EPS</span><strong>{stock.epsForward}</strong></div>}
                  {stock.priceToBook != null && <div className="stk-stat"><span>P/B Ratio <InfoTip term="priceToBook" /></span><strong>{stock.priceToBook}</strong></div>}
                  {stock.beta != null && <div className="stk-stat"><span>Beta <InfoTip term="beta" /></span><strong>{stock.beta}</strong></div>}
                  {stock.dividendYield != null && (
                    <div className="stk-stat"><span>Div Yield <InfoTip term="dividendYield" /></span><strong>{stock.dividendYield.toFixed(2)}%</strong></div>
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

            {/* ── Analyst Recommendations ── */}
            {recommendations.length > 0 && (() => {
              const latest = recommendations[0];
              const total = latest.strongBuy + latest.buy + latest.hold + latest.sell + latest.strongSell;
              if (total === 0) return null;
              return (
                <article className="findec-panel stk-analyst-panel">
                  <p className="findec-kicker">Analyst Consensus · {latest.period}</p>
                  <div className="stk-analyst-bar">
                    {latest.strongBuy > 0 && <div className="stk-analyst-seg stk-analyst-sbuy" style={{ width: `${(latest.strongBuy / total) * 100}%` }} title={`Strong Buy: ${latest.strongBuy}`} />}
                    {latest.buy > 0 && <div className="stk-analyst-seg stk-analyst-buy" style={{ width: `${(latest.buy / total) * 100}%` }} title={`Buy: ${latest.buy}`} />}
                    {latest.hold > 0 && <div className="stk-analyst-seg stk-analyst-hold" style={{ width: `${(latest.hold / total) * 100}%` }} title={`Hold: ${latest.hold}`} />}
                    {latest.sell > 0 && <div className="stk-analyst-seg stk-analyst-sell" style={{ width: `${(latest.sell / total) * 100}%` }} title={`Sell: ${latest.sell}`} />}
                    {latest.strongSell > 0 && <div className="stk-analyst-seg stk-analyst-ssell" style={{ width: `${(latest.strongSell / total) * 100}%` }} title={`Strong Sell: ${latest.strongSell}`} />}
                  </div>
                  <div className="stk-analyst-labels">
                    <span className="findec-subline-up">S.Buy {latest.strongBuy}</span>
                    <span className="findec-subline-up">Buy {latest.buy}</span>
                    <span>Hold {latest.hold}</span>
                    <span className="findec-subline-down">Sell {latest.sell}</span>
                    <span className="findec-subline-down">S.Sell {latest.strongSell}</span>
                  </div>
                  <p className="stk-analyst-total">{total} analysts · click for full history</p>
                </article>
              );
            })()}

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
                      {article.imageUrl && (
                        <div className="stk-news-img-wrap">
                          <img
                            src={article.imageUrl}
                            alt=""
                            className="stk-news-img"
                            loading="lazy"
                            onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = "none"; }}
                          />
                        </div>
                      )}
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
