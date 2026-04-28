"use client";

import { useEffect, useMemo, useState } from "react";
import { getMarketHistory, getMarketSnapshot, sendQuery } from "../services/api";
import type { MarketHistory, MarketSnapshot, QueryResponse, RiskProfile } from "../types";

const LOCAL_SETTINGS_KEY = "findec-local-settings";
const WATCHLIST_KEY = "findec-watchlist";
const MAX_WATCHLIST = 6;

type WatchlistEntry = {
  ticker: string;
  label: string;
};

const SAMPLE_RESULT: QueryResponse = {
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
    action: "Infosys looks stable for a medium risk investor. No urgent action needed — watch the rupee this week."
  }
};

const SAMPLE_WATCHLIST: Array<{ label: string; price: string; move: string; meta: string; tone: "up" | "down" }> = [
  { label: "INFY", price: "₹1,482", move: "+1.2%", meta: "IT · large cap", tone: "up" },
  { label: "HDFC Bank", price: "₹1,641", move: "-0.4%", meta: "Banking · large cap", tone: "down" },
  { label: "Mirae Asset ELSS", price: "₹32.4 NAV", move: "+0.2%", meta: "MF · tax saving", tone: "up" }
];

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
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: value >= 100 ? 0 : 1
  }).format(value);
}

function formatRupees(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: value >= 100 ? 0 : 1
  }).format(value);
}

function todayLabel(asOf?: string): string {
  if (!asOf) {
    return "28 Apr 2026";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(asOf));
}

function safeParseWatchlist(raw: string | null): WatchlistEntry[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as WatchlistEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_WATCHLIST) : [];
  } catch {
    return [];
  }
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
    return "finity-tag-green";
  }
  if (value === "Not suited") {
    return "finity-tag-red";
  }
  return "finity-tag-amber";
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
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [marketSnapshot, setMarketSnapshot] = useState<MarketSnapshot | null>(null);
  const [marketHistory, setMarketHistory] = useState<MarketHistory | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<QueryResponse | null>(null);

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
    return watchlist.map((entry) => ({
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

    setWatchlist(safeParseWatchlist(window.localStorage.getItem(WATCHLIST_KEY)));
  }, []);

  useEffect(() => {
    if (!initialTicker.trim()) {
      return;
    }

    setTicker(initialTicker.trim().toUpperCase());
    setQuery((current) => current || `What is the outlook for ${initialTicker.trim().toUpperCase()} today?`);
    setError("");
  }, [initialTicker]);

  useEffect(() => {
    if (!initialQuery.trim()) {
      return;
    }

    setQuery(initialQuery.trim());
    setTicker((current) => current || extractTicker(initialQuery));
    setError("");
  }, [initialQuery]);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not build your brief right now.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="finity-minimal-page">
      <div className="finity-minimal-shell">
        <form className="finity-search-row" onSubmit={handleRun}>
          <input
            className="finity-search-input"
            placeholder="ask about any stock, sector, or fund..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button className="finity-search-button" disabled={!query.trim() || running} type="submit">
            {running ? "..." : "brief →"}
          </button>
        </form>

        <section className="finity-market-grid">
          {marketCards.map((card) => (
            <article key={card.label} className="finity-panel finity-metric-panel">
              <p className="finity-kicker">{card.label}</p>
              <strong>{card.value}</strong>
              <span className={`finity-subline finity-subline-${card.tone}`}>{card.subtext}</span>
            </article>
          ))}
        </section>

        {error && (
          <section className="finity-panel finity-error-panel">
            <p>{error}</p>
          </section>
        )}

        <section className="finity-panel finity-chart-panel">
          <div className="finity-chart-top">
            <div>
              <p className="finity-kicker">30 day price graph · {displaySymbol}</p>
              <strong className="finity-chart-price">
                {marketHistory ? formatRupees(marketHistory.latestClose) : "₹1,482"}
              </strong>
            </div>
            <div className="finity-chart-stats">
              <div>
                <span>30d return</span>
                <strong className={marketHistory && marketHistory.changePercent30d < 0 ? "finity-subline-down" : "finity-subline-up"}>
                  {marketHistory ? formatSignedPercent(marketHistory.changePercent30d) : "+4.8%"}
                </strong>
              </div>
              <div>
                <span>High / Low</span>
                <strong>
                  {marketHistory ? `${formatRupees(marketHistory.high30d)} / ${formatRupees(marketHistory.low30d)}` : "₹1,522 / ₹1,406"}
                </strong>
              </div>
            </div>
          </div>

          <div className="finity-chart-shell">
            <svg className="finity-chart-svg" viewBox="0 0 760 180" aria-label="30 day company price chart" role="img">
              <line x1="0" y1="30" x2="760" y2="30" className="finity-chart-grid" />
              <line x1="0" y1="90" x2="760" y2="90" className="finity-chart-grid" />
              <line x1="0" y1="150" x2="760" y2="150" className="finity-chart-grid" />
              {chartPolyline ? <polyline fill="none" stroke="#79b53a" strokeWidth="2.2" points={chartPolyline} /> : null}
            </svg>
          </div>
        </section>

        <section className="finity-results-grid">
          <article className="finity-panel finity-agent-panel">
            <p className="finity-kicker">Researcher agent · {displaySymbol}</p>
            <div className="finity-agent-head">
              <div>
                <span
                  className={`finity-tag ${
                    displayResult.researcher.sentiment === "Bullish"
                      ? "finity-tag-green"
                      : displayResult.researcher.sentiment === "Bearish"
                        ? "finity-tag-red"
                        : "finity-tag-amber"
                  }`}
                >
                  {displayResult.researcher.sentiment}
                </span>
                <p className="finity-copy">{marketMoodCopy(activeQuote?.changePercent, marketHistory?.changePercent30d)}</p>
              </div>
              <strong className="finity-big-score">{displayResult.researcher.sentiment_confidence}%</strong>
            </div>

            <div className="finity-section-line" />

            <div className="finity-bar-labels">
              <span>Bull</span>
              <span>Bear</span>
            </div>
            <div className="finity-sentiment-bar">
              <div className="finity-sentiment-bull" style={{ width: `${displayResult.researcher.bull_ratio}%` }} />
              <div className="finity-sentiment-bear" style={{ width: `${displayResult.researcher.bear_ratio}%` }} />
            </div>
            <div className="finity-bar-values">
              <span>{displayResult.researcher.bull_ratio}</span>
              <span>{displayResult.researcher.bear_ratio}</span>
            </div>

            <div className="finity-bullet-list">
              {displayResult.researcher.top_signals.map((signal) => (
                <p key={signal}>• {signal}</p>
              ))}
            </div>
          </article>

          <article className="finity-panel finity-agent-panel">
            <p className="finity-kicker">Analyst agent · {displaySymbol}</p>

            <div className="finity-info-block">
              <span>P/E Ratio</span>
              <strong>{displayResult.analyst.pe_ratio}</strong>
              <p>{displayResult.analyst.pe_context}</p>
            </div>

            <div className="finity-info-block">
              <span>5-day momentum</span>
              <strong>{displayResult.analyst.momentum_5d}</strong>
              <p>{displayResult.analyst.momentum_context}</p>
            </div>

            <div className="finity-info-block">
              <span>AI confidence</span>
              <strong>{displayResult.analyst.ai_confidence} / 100</strong>
              <p>{displayResult.analyst.ai_confidence_context}</p>
            </div>

            <div className="finity-info-block finity-info-block-last">
              <span>Short term outlook</span>
              <div className="finity-tag-row">
                <span className="finity-tag finity-tag-green">
                  {displayResult.analyst.outlook} · {displayResult.analyst.outlook_timeframe}
                </span>
              </div>
            </div>
          </article>
        </section>

        <section className="finity-panel finity-risk-panel">
          <p className="finity-kicker">Risk manager · your profile: {riskProfile.toUpperCase()} risk</p>
          <div className="finity-risk-grid">
            <div>
              <span>Suitability</span>
              <div className="finity-tag-row">
                <span className={`finity-tag ${suitabilityTone(displayResult.risk_manager.suitability)}`}>{displayResult.risk_manager.suitability}</span>
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

        <section className="finity-action-banner">
          <p className="finity-kicker">What to do today</p>
          <strong>{liveActionText(displayResult.risk_manager.action, marketHistory, activeQuote?.changePercent)}</strong>
        </section>

        <section className="finity-panel finity-watchlist-panel">
          <p className="finity-kicker">Your watchlist</p>
          <div className="finity-watchlist-list">
            {watchlistCards.length > 0
              ? watchlistCards.map((item) => (
                  <div key={item.ticker} className="finity-watchlist-row finity-watchlist-row-static">
                    <div className="finity-watchlist-meta">
                      <strong>{item.label}</strong>
                      <span>{item.ticker}</span>
                    </div>
                    <div className="finity-watchlist-price">
                      <strong>{item.quote ? formatRupees(item.quote.lastClose) : item.ticker}</strong>
                      <span className={item.quote && item.quote.changePercent < 0 ? "finity-subline-down" : "finity-subline-up"}>
                        {item.quote ? formatSignedPercent(item.quote.changePercent) : "saved"}
                      </span>
                    </div>
                  </div>
                ))
              : SAMPLE_WATCHLIST.map((item) => (
                  <div key={item.label} className="finity-watchlist-row finity-watchlist-row-static">
                    <div className="finity-watchlist-meta">
                      <strong>{item.label}</strong>
                      <span>{item.meta}</span>
                    </div>
                    <div className="finity-watchlist-price">
                      <strong>{item.price}</strong>
                      <span className={item.tone === "down" ? "finity-subline-down" : "finity-subline-up"}>{item.move}</span>
                    </div>
                  </div>
                ))}
          </div>
        </section>
      </div>
    </section>
  );
}
