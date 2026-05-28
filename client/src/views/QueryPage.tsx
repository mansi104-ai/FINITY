"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { getMarketHistory, getMarketSnapshot, getSessionUser, getStockDetail, getWatchlist, sendQuery, subscribeToAuthChanges, type WatchlistItemApi } from "../services/api";
import type { MarketHistory, MarketSnapshot, QueryResponse, RiskProfile, StockQuote } from "../types";

const LOCAL_SETTINGS_KEY = "findec-local-settings";
const MAX_WATCHLIST = 6;

const SAMPLE_RESULT: QueryResponse = {
  reportId: "",
  disclaimer: "FINDEC is a decision support tool only and does not constitute financial advice.",
  estimated: true,
  researcher: {
    sentiment: "Bullish",
    sentiment_confidence: 82,
    bull_ratio: 65,
    bear_ratio: 35,
    top_signals: [
      "Q4 results beat estimates by 3.2%",
      "New 500M deal signed with US client",
      "FII buying increased this week"
    ]
  },
  analyst: {
    pe_ratio: 25.4,
    pe_context: "Slightly above sector avg of 23 · fairly priced",
    momentum_5d: "+2.8%",
    momentum_context: "Rising steadily this week",
    ai_confidence: 78,
    ai_confidence_context: "Signals are mostly agreeing with each other",
    outlook: "Positive",
    outlook_timeframe: "2-4 weeks"
  },
  risk_manager: {
    suitability: "Suited for you",
    risk_note: "Rupee depreciation may hurt IT margins",
    opportunity_note: "US deal pipeline expanding into Q1",
    action: "Infosys looks stable for a medium risk investor. No urgent action needed - watch the rupee this week."
  }
};


function extractTicker(query: string): string {
  const dollarMatch = query.toUpperCase().match(/\$([A-Z][A-Z0-9.-]{0,14})\b/);
  if (dollarMatch?.[1]) {
    return dollarMatch[1];
  }

  const symbolMatch = query.toUpperCase().match(/\b[A-Z][A-Z0-9.-]{0,14}\b/);
  return symbolMatch?.[0] ?? "";
}

function formatSignedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 1
  }).format(value);
}

function formatPrice(value: number, currency?: string): string {
  const cur = currency ?? "USD";
  const fracs = value >= 100 ? 0 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: cur,
    minimumFractionDigits: fracs,
    maximumFractionDigits: fracs
  }).format(value);
}



function defaultMarketCards(snapshot: MarketSnapshot | null): Array<{ label: string; value: string; subtext: string; tone: "up" | "down" | "neutral" }> {
  const first = snapshot?.tickers[0];
  const second = snapshot?.tickers[1];
  const third = snapshot?.tickers[2];
  const fourth = snapshot?.tickers[3];

  return [
    {
      label: first?.symbol ?? "NIFTY 50",
      value: first ? compactNumber(first.lastClose) : "22,419",
      subtext: first ? `${formatSignedPercent(first.changePercent)} today` : "+0.6% today",
      tone: first ? (first.changePercent >= 0 ? "up" : "down") : "up"
    },
    {
      label: second?.symbol ?? "SENSEX",
      value: second ? compactNumber(second.lastClose) : "73,847",
      subtext: second ? `${formatSignedPercent(second.changePercent)} today` : "+0.4% today",
      tone: second ? (second.changePercent >= 0 ? "up" : "down") : "up"
    },
    {
      label: third?.symbol ?? "INDIA VIX",
      value: third ? compactNumber(third.lastClose) : "13.2",
      subtext: third ? (third.changePercent >= 0 ? "higher volatility" : "low fear · stable") : "low fear · stable",
      tone: "neutral"
    },
    {
      label: fourth?.symbol ?? "USD / INR",
      value: fourth ? compactNumber(fourth.lastClose) : "83.54",
      subtext: fourth ? (fourth.changePercent >= 0 ? "rupee slightly weak" : "rupee slightly firm") : "rupee slightly weak",
      tone: fourth ? (fourth.changePercent >= 0 ? "down" : "up") : "down"
    }
  ];
}

function suitabilityTone(value: QueryResponse["risk_manager"]["suitability"]): string {
  if (value === "Suited for you") {
    return "findec-tag-green";
  }
  if (value === "Not suited") {
    return "findec-tag-red";
  }
  return "findec-tag-amber";
}

function toChartPoints(points: MarketHistory["points"], width: number, height: number): string {
  if (points.length === 0) {
    return "";
  }

  const closes = points.map((point) => point.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = Math.max(max - min, 1);

  return points
    .map((point, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * width;
      const y = height - ((point.close - min) / range) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function marketMoodCopy(change1d?: number, change30d?: number): string {
  if (typeof change1d === "number" && change1d >= 1.2) {
    return "Market mood is strongly positive for this stock today";
  }
  if (typeof change1d === "number" && change1d <= -1.2) {
    return "Market mood is cautious for this stock today";
  }
  if (typeof change30d === "number" && change30d >= 6) {
    return "Market mood stays constructive after a strong month";
  }
  if (typeof change30d === "number" && change30d <= -6) {
    return "Market mood remains fragile after a weak month";
  }
  return "Market mood is steady for this stock today";
}

function liveActionText(baseAction: string, history: MarketHistory | null, dayMove?: number): string {
  if (!history) {
    return baseAction;
  }

  const dayText = typeof dayMove === "number" ? `${dayMove >= 0 ? "+" : ""}${dayMove.toFixed(1)}% today` : "today";
  const monthText = `${history.changePercent30d >= 0 ? "+" : ""}${history.changePercent30d.toFixed(1)}% over 30 days`;
  return `${baseAction} ${dayText}; ${monthText}.`;
}

export default function QueryPage({ initialTicker = "", initialQuery = "" }: { initialTicker?: string; initialQuery?: string }) {
  const [query, setQuery] = useState("");
  const [ticker, setTicker] = useState("");
  const [budget, setBudget] = useState(10000);
  const [riskProfile, setRiskProfile] = useState<RiskProfile>("medium");
  const [watchlist, setWatchlist] = useState<WatchlistItemApi[]>([]);
  const [marketSnapshot, setMarketSnapshot] = useState<MarketSnapshot | null>(null);
  const [marketHistory, setMarketHistory] = useState<MarketHistory | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [latestReportId, setLatestReportId] = useState("");
  const [stockFundamentals, setStockFundamentals] = useState<StockQuote | null>(null);
  const hydratedParamsRef = useRef("");

  const activeSymbol = useMemo(() => (ticker || extractTicker(query) || "").trim().toUpperCase(), [query, ticker]);
  const activeTicker = useMemo(() => {
    if (!activeSymbol) {
      return "INFY.NS";
    }
    if (activeSymbol.includes(".")) {
      return activeSymbol;
    }
    if (activeSymbol === "INFOSYS") {
      return "INFY.NS";
    }
    return activeSymbol;
  }, [activeSymbol]);
  const displayResult = result ?? SAMPLE_RESULT;
  const activeQuote = useMemo(
    () => marketSnapshot?.tickers.find((item) => item.symbol.toUpperCase() === activeTicker.toUpperCase()) ?? null,
    [activeTicker, marketSnapshot]
  );
  const displaySymbol = marketHistory?.name?.toUpperCase?.() || activeSymbol || "INFOSYS";
  const marketCards = useMemo(() => defaultMarketCards(marketSnapshot), [marketSnapshot]);
  const watchlistCards = useMemo(() => {
    return watchlist.slice(0, MAX_WATCHLIST).map((entry) => ({
      ...entry,
      quote: marketSnapshot?.tickers.find((item) => item.symbol.toUpperCase() === entry.ticker.toUpperCase()) ?? null
    }));
  }, [marketSnapshot, watchlist]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const saved = window.localStorage.getItem(LOCAL_SETTINGS_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { budget?: number; riskProfile?: RiskProfile };
        if (typeof parsed.budget === "number") {
          setBudget(parsed.budget);
        }
        if (parsed.riskProfile) {
          setRiskProfile(parsed.riskProfile);
        }
      } catch {
        window.localStorage.removeItem(LOCAL_SETTINGS_KEY);
      }
    }

    const syncWatchlist = () => {
      if (getSessionUser()) {
        getWatchlist()
          .then((res) => setWatchlist(res.items))
          .catch(() => setWatchlist([]));
      } else {
        setWatchlist([]);
      }
    };
    syncWatchlist();
    return subscribeToAuthChanges(syncWatchlist);
  }, []);

  useEffect(() => {
    const normalizedTicker = initialTicker.trim().toUpperCase();
    const trimmedQuery = initialQuery.trim();
    const hydrationKey = `${normalizedTicker}::${trimmedQuery}`;

    if (hydratedParamsRef.current === hydrationKey) {
      return;
    }

    hydratedParamsRef.current = hydrationKey;

    if (trimmedQuery) {
      setQuery(trimmedQuery);
      setTicker(normalizedTicker || extractTicker(trimmedQuery));
      setError("");
      return;
    }

    if (normalizedTicker) {
      setTicker(normalizedTicker);
      setQuery(`What is the outlook for ${normalizedTicker} today?`);
      setError("");
    }
  }, [initialQuery, initialTicker]);

  useEffect(() => {
    const loadSnapshot = async () => {
      try {
        setMarketSnapshot(await getMarketSnapshot());
      } catch {
        setMarketSnapshot(null);
      }
    };

    void loadSnapshot();
  }, []);

  useEffect(() => {
    const loadHistory = async () => {
      try {
        setMarketHistory(await getMarketHistory(activeTicker));
      } catch {
        setMarketHistory(null);
      }
    };

    void loadHistory();
  }, [activeTicker]);

  useEffect(() => {
    if (!activeTicker || activeTicker.startsWith("^")) {
      setStockFundamentals(null);
      return;
    }
    const loadFundamentals = async () => {
      try {
        setStockFundamentals(await getStockDetail(activeTicker));
      } catch {
        setStockFundamentals(null);
      }
    };
    void loadFundamentals();
  }, [activeTicker]);

  const chartPolyline = useMemo(() => {
    return marketHistory ? toChartPoints(marketHistory.points, 760, 180) : "";
  }, [marketHistory]);

  const handleRun = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRunning(true);
    setError("");

    try {
      const normalizedTicker = ticker.trim().toUpperCase();
      const response = await sendQuery({
        query,
        ticker: normalizedTicker || undefined,
        budget,
        riskProfile,
        version: 4
      });

      setResult(response);
      setLatestReportId(response.reportId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not build your brief right now.");
    } finally {
      setRunning(false);
    }
  };

  function fmtCap(v: number): string {
    if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    return v.toLocaleString();
  }

  function posIn52w(price: number, low: number, high: number): number {
    if (high <= low) return 50;
    return Math.min(100, Math.max(0, ((price - low) / (high - low)) * 100));
  }

  return (
    <section className="findec-minimal-page">
      <div className="findec-minimal-shell">
        <form className="findec-search-row" onSubmit={handleRun}>
          <input
            className="findec-search-input"
            placeholder="ask about any stock, sector, or fund..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button className="findec-search-button" disabled={!query.trim() || running} type="submit">
            {running ? "..." : "brief ->"}
          </button>
        </form>

        <section className="findec-market-grid">
          {marketCards.map((card) => (
            <article key={card.label} className="findec-panel findec-metric-panel">
              <p className="findec-kicker">{card.label}</p>
              <strong>{card.value}</strong>
              <span className={`findec-subline findec-subline-${card.tone}`}>{card.subtext}</span>
            </article>
          ))}
        </section>

        {error && (
          <section className="findec-panel findec-error-panel">
            <p>{error}</p>
          </section>
        )}

        <section className="findec-panel findec-chart-panel">
          <div className="findec-chart-top">
            <div>
              <p className="findec-kicker">30 day price graph · {displaySymbol}</p>
              <strong className="findec-chart-price">
                {marketHistory ? formatPrice(marketHistory.latestClose, stockFundamentals?.currency) : "—"}
              </strong>
            </div>
            <div className="findec-chart-stats">
              <div>
                <span>30d return</span>
                <strong className={marketHistory && marketHistory.changePercent30d < 0 ? "findec-subline-down" : "findec-subline-up"}>
                  {marketHistory ? formatSignedPercent(marketHistory.changePercent30d) : "—"}
                </strong>
              </div>
              <div>
                <span>High / Low</span>
                <strong>
                  {marketHistory
                    ? `${formatPrice(marketHistory.high30d, stockFundamentals?.currency)} / ${formatPrice(marketHistory.low30d, stockFundamentals?.currency)}`
                    : "—"}
                </strong>
              </div>
            </div>
          </div>

          <div className="findec-chart-shell">
            <svg className="findec-chart-svg" viewBox="0 0 760 180" aria-label="30 day company price chart" role="img">
              <line x1="0" y1="30" x2="760" y2="30" className="findec-chart-grid" />
              <line x1="0" y1="90" x2="760" y2="90" className="findec-chart-grid" />
              <line x1="0" y1="150" x2="760" y2="150" className="findec-chart-grid" />
              {chartPolyline ? <polyline fill="none" stroke="#79b53a" strokeWidth="2.2" points={chartPolyline} /> : null}
            </svg>
          </div>
        </section>

        {stockFundamentals && (
          <section className="findec-panel findec-fundamentals-panel">
            <p className="findec-kicker">Fundamentals · {stockFundamentals.name}</p>
            <div className="findec-fund-grid">
              {stockFundamentals.marketCap != null && (
                <div className="findec-fund-item">
                  <span>Market Cap</span>
                  <strong>{fmtCap(stockFundamentals.marketCap)}</strong>
                </div>
              )}
              {stockFundamentals.peRatio != null && (
                <div className="findec-fund-item">
                  <span>P/E (TTM)</span>
                  <strong>{stockFundamentals.peRatio}</strong>
                </div>
              )}
              {stockFundamentals.forwardPE != null && (
                <div className="findec-fund-item">
                  <span>Forward P/E</span>
                  <strong>{stockFundamentals.forwardPE}</strong>
                </div>
              )}
              {stockFundamentals.eps != null && (
                <div className="findec-fund-item">
                  <span>EPS (TTM)</span>
                  <strong>{stockFundamentals.eps}</strong>
                </div>
              )}
              {stockFundamentals.dividendYield != null && (
                <div className="findec-fund-item">
                  <span>Div Yield</span>
                  <strong>{stockFundamentals.dividendYield.toFixed(2)}%</strong>
                </div>
              )}
              {stockFundamentals.beta != null && (
                <div className="findec-fund-item">
                  <span>Beta</span>
                  <strong>{stockFundamentals.beta}</strong>
                </div>
              )}
              {stockFundamentals.priceToBook != null && (
                <div className="findec-fund-item">
                  <span>P/B Ratio</span>
                  <strong>{stockFundamentals.priceToBook}</strong>
                </div>
              )}
              {stockFundamentals.volume != null && (
                <div className="findec-fund-item">
                  <span>Volume</span>
                  <strong>{(stockFundamentals.volume / 1e6).toFixed(1)}M</strong>
                </div>
              )}
            </div>
            {stockFundamentals.high52w != null && stockFundamentals.low52w != null && (
              <div className="findec-fund-52w">
                <span className="findec-fund-52w-label">52-Week Range</span>
                <div className="findec-fund-52w-bar">
                  <span className="findec-fund-52w-lo">{stockFundamentals.low52w.toLocaleString()}</span>
                  <div className="findec-fund-52w-track">
                    <div
                      className="findec-fund-52w-dot"
                      style={{ left: `${posIn52w(stockFundamentals.price, stockFundamentals.low52w, stockFundamentals.high52w)}%` }}
                    />
                  </div>
                  <span className="findec-fund-52w-hi">{stockFundamentals.high52w.toLocaleString()}</span>
                </div>
                {stockFundamentals.ma50 != null && stockFundamentals.ma200 != null && (
                  <div className="findec-fund-ma-row">
                    <span>MA50 <strong>{stockFundamentals.ma50.toLocaleString()}</strong></span>
                    <span>MA200 <strong>{stockFundamentals.ma200.toLocaleString()}</strong></span>
                    <span className={stockFundamentals.price > stockFundamentals.ma50 ? "findec-subline-up" : "findec-subline-down"}>
                      {stockFundamentals.price > stockFundamentals.ma50 ? "Above MA50" : "Below MA50"}
                    </span>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        <section className="findec-results-grid">
          <article className="findec-panel findec-agent-panel">
            <p className="findec-kicker">Researcher agent · {displaySymbol}</p>
            <div className="findec-agent-head">
              <div>
                <span
                  className={`findec-tag ${
                    displayResult.researcher.sentiment === "Bullish"
                      ? "findec-tag-green"
                      : displayResult.researcher.sentiment === "Bearish"
                        ? "findec-tag-red"
                        : "findec-tag-amber"
                  }`}
                >
                  {displayResult.researcher.sentiment}
                </span>
                <p className="findec-copy">{marketMoodCopy(activeQuote?.changePercent, marketHistory?.changePercent30d)}</p>
              </div>
              <strong className="findec-big-score">{displayResult.researcher.sentiment_confidence}%</strong>
            </div>

            <div className="findec-section-line" />

            <div className="findec-bar-labels">
              <span>Bull</span>
              <span>Bear</span>
            </div>
            <div className="findec-sentiment-bar">
              <div className="findec-sentiment-bull" style={{ width: `${displayResult.researcher.bull_ratio}%` }} />
              <div className="findec-sentiment-bear" style={{ width: `${displayResult.researcher.bear_ratio}%` }} />
            </div>
            <div className="findec-bar-values">
              <span>{displayResult.researcher.bull_ratio}</span>
              <span>{displayResult.researcher.bear_ratio}</span>
            </div>

            <div className="findec-bullet-list">
              {displayResult.researcher.top_signals.map((signal) => (
                <p key={signal}>- {signal}</p>
              ))}
            </div>
          </article>

          <article className="findec-panel findec-agent-panel">
            <p className="findec-kicker">Analyst agent · {displaySymbol}</p>

            <div className="findec-info-block">
              <span>P/E Ratio</span>
              <strong>{displayResult.analyst.pe_ratio}</strong>
              <p>{displayResult.analyst.pe_context}</p>
            </div>

            <div className="findec-info-block">
              <span>5-day momentum</span>
              <strong>{displayResult.analyst.momentum_5d}</strong>
              <p>{displayResult.analyst.momentum_context}</p>
            </div>

            <div className="findec-info-block">
              <span>AI confidence</span>
              <strong>{displayResult.analyst.ai_confidence} / 100</strong>
              <p>{displayResult.analyst.ai_confidence_context}</p>
            </div>

            <div className="findec-info-block findec-info-block-last">
              <span>Short term outlook</span>
              <div className="findec-tag-row">
                <span className="findec-tag findec-tag-green">
                  {displayResult.analyst.outlook} · {displayResult.analyst.outlook_timeframe}
                </span>
              </div>
            </div>
          </article>
        </section>

        <section className="findec-panel findec-risk-panel">
          <p className="findec-kicker">Risk manager · your profile: {riskProfile.toUpperCase()} risk</p>
          <div className="findec-risk-grid">
            <div>
              <span>Suitability</span>
              <div className="findec-tag-row">
                <span className={`findec-tag ${suitabilityTone(displayResult.risk_manager.suitability)}`}>{displayResult.risk_manager.suitability}</span>
              </div>
            </div>
            <div>
              <span>Watch out for</span>
              <strong>{displayResult.risk_manager.risk_note}</strong>
            </div>
            <div>
              <span>Opportunity</span>
              <strong>{displayResult.risk_manager.opportunity_note}</strong>
            </div>
          </div>
        </section>

        <section className="findec-action-banner">
          <p className="findec-kicker">What to do today</p>
          <strong>{liveActionText(displayResult.risk_manager.action, marketHistory, activeQuote?.changePercent)}</strong>
          <p className="findec-disclaimer-text">{displayResult.disclaimer}</p>
          {latestReportId ? (
            <div className="findec-inline-actions">
              <Link className="findec-inline-link-button" href={`/report/${latestReportId}`}>
                Open saved report
              </Link>
              <Link className="findec-inline-link-button findec-inline-link-button-muted" href="/history">
                View report archive
              </Link>
            </div>
          ) : null}
        </section>

        <section className="findec-panel findec-watchlist-panel">
          <p className="findec-kicker">Your watchlist</p>
          <div className="findec-watchlist-list">
            {watchlistCards.length > 0
              ? watchlistCards.map((item) => (
                  <div key={item.ticker} className="findec-watchlist-row findec-watchlist-row-static">
                    <div className="findec-watchlist-meta">
                      <strong>{item.ticker}</strong>
                      <span>{item.name}</span>
                    </div>
                    <div className="findec-watchlist-price">
                      <strong>
                        {item.quote
                          ? formatPrice(item.quote.lastClose, item.quote.currency)
                          : "—"}
                      </strong>
                      <span className={item.quote && item.quote.changePercent < 0 ? "findec-subline-down" : "findec-subline-up"}>
                        {item.quote ? formatSignedPercent(item.quote.changePercent) : ""}
                      </span>
                    </div>
                  </div>
                ))
              : (
                <p className="findec-kicker" style={{ margin: "0.5rem 0", color: "#696d72" }}>
                  <Link href="/watchlist" style={{ color: "#79b53a" }}>Add stocks to your watchlist →</Link>
                </p>
              )}
          </div>
        </section>
      </div>
    </section>
  );
}
