"use client";

import { useEffect, useMemo, useState } from "react";
import { getMarketSnapshot, sendQuery } from "../services/api";
import type { MarketSnapshot, QueryResponse, RiskProfile } from "../types";
import AgentStatusCard from "../components/AgentStatusCard";
import { MetricInfoPopover } from "../components/MetricInfoPopover";

const LOCAL_SETTINGS_KEY = "findec-local-settings";
const RECENT_SEARCHES_KEY = "findec-recent-searches";
const WATCHLIST_KEY = "findec-watchlist";
const MAX_RECENT_SEARCHES = 4;
const MAX_WATCHLIST = 6;

type RecentSearch = {
  label: string;
  query: string;
  ticker?: string;
};

type WatchlistEntry = {
  ticker: string;
  label: string;
};

const quickPrompts: Array<{ label: string; query: string; ticker?: string }> = [
  {
    label: "Check Apple",
    query: "Is Apple a good buy today after recent market moves?",
    ticker: "AAPL"
  },
  {
    label: "Tesla today",
    query: "What is the outlook for Tesla today?",
    ticker: "TSLA"
  },
  {
    label: "Microsoft long term",
    query: "Is Microsoft still a good long-term investment?",
    ticker: "MSFT"
  },
  {
    label: "Market mood",
    query: "How does the market look today for regular investors?"
  }
];

const comfortOptions: Array<{
  value: RiskProfile;
  label: string;
  description: string;
}> = [
  { value: "low", label: "Careful", description: "Smaller swings and more caution" },
  { value: "medium", label: "Balanced", description: "A mix of safety and upside" },
  { value: "high", label: "Adventurous", description: "More upside, more volatility" }
];

function extractTicker(query: string): string {
  const dollarMatch = query.toUpperCase().match(/\$([A-Z][A-Z0-9.-]{0,14})\b/);
  if (dollarMatch?.[1]) {
    return dollarMatch[1];
  }

  const symbolMatch = query.toUpperCase().match(/\b[A-Z][A-Z0-9.-]{0,14}\b/);
  return symbolMatch?.[0] ?? "";
}

function currency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function formatSignedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function safeParseRecentSearches(raw: string | null): RecentSearch[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as RecentSearch[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT_SEARCHES) : [];
  } catch {
    return [];
  }
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

function buildTickerQuestion(ticker: string, label: string): string {
  return `What is the outlook for ${label} (${ticker}) today?`;
}

function isMajorIndex(symbol: string): boolean {
  return symbol.startsWith("^");
}

function briefToneClass(result: QueryResponse): string {
  if (result.risk_manager.suitability === "Suited for you") {
    return "trend-up";
  }
  if (result.risk_manager.suitability === "Not suited") {
    return "trend-down";
  }
  return "trend-flat";
}

function briefHeadline(result: QueryResponse, symbol: string): string {
  if (result.risk_manager.suitability === "Suited for you") {
    return `${symbol || "This stock"} looks worth tracking closely`;
  }
  if (result.risk_manager.suitability === "Not suited") {
    return `${symbol || "This stock"} needs more caution right now`;
  }
  return `${symbol || "This stock"} looks mixed for now`;
}

function briefSummary(result: QueryResponse): string {
  return `${result.researcher.sentiment} sentiment, ${result.analyst.outlook.toLowerCase()} outlook, and ${result.risk_manager.suitability.toLowerCase()} fit for your risk level.`;
}

export default function QueryPage({ initialTicker = "", initialQuery = "" }: { initialTicker?: string; initialQuery?: string }) {
  const [query, setQuery] = useState("");
  const [ticker, setTicker] = useState("");
  const [budget, setBudget] = useState(10000);
  const [riskProfile, setRiskProfile] = useState<RiskProfile>("medium");
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [marketSnapshot, setMarketSnapshot] = useState<MarketSnapshot | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<QueryResponse | null>(null);

  const placeholderTicker = useMemo(() => extractTicker(query), [query]);
  const allocationHint = useMemo(() => Math.round(budget * 0.08), [budget]);
  const activeSymbol = useMemo(() => (ticker || placeholderTicker || "").trim().toUpperCase(), [placeholderTicker, ticker]);

  const activeSymbolSaved = useMemo(
    () => watchlist.some((entry) => entry.ticker.toUpperCase() === activeSymbol),
    [activeSymbol, watchlist]
  );

  const tradableTickers = useMemo(
    () => marketSnapshot?.tickers.filter((item) => !isMajorIndex(item.symbol)) ?? [],
    [marketSnapshot]
  );

  const movers = useMemo(() => {
    return [...tradableTickers]
      .sort((left, right) => Math.abs(right.changePercent) - Math.abs(left.changePercent))
      .slice(0, 4);
  }, [tradableTickers]);

  const topGainer = useMemo(() => {
    return [...tradableTickers].sort((left, right) => right.changePercent - left.changePercent)[0] ?? null;
  }, [tradableTickers]);

  const topLoser = useMemo(() => {
    return [...tradableTickers].sort((left, right) => left.changePercent - right.changePercent)[0] ?? null;
  }, [tradableTickers]);

  const marketMood = useMemo(() => {
    if (!marketSnapshot || marketSnapshot.tickers.length === 0) {
      return "Waiting for market data";
    }

    const averageChange =
      marketSnapshot.tickers.reduce((sum, item) => sum + item.changePercent, 0) / marketSnapshot.tickers.length;

    if (averageChange > 0.25) {
      return "Positive start";
    }

    if (averageChange < -0.25) {
      return "Cautious tone";
    }

    return "Mixed market";
  }, [marketSnapshot]);

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

    setRecentSearches(safeParseRecentSearches(window.localStorage.getItem(RECENT_SEARCHES_KEY)));
    setWatchlist(safeParseWatchlist(window.localStorage.getItem(WATCHLIST_KEY)));
  }, []);

  useEffect(() => {
    const normalizedTicker = initialTicker.trim().toUpperCase();
    if (!normalizedTicker) {
      return;
    }

    setTicker(normalizedTicker);
    setQuery((current) => current || `Build a market brief for ${normalizedTicker} and explain the key drivers today.`);
    setError("");
  }, [initialTicker]);

  useEffect(() => {
    const trimmedQuery = initialQuery.trim();
    if (!trimmedQuery) {
      return;
    }

    setQuery(trimmedQuery);
    setTicker((current) => current || extractTicker(trimmedQuery));
    setError("");
  }, [initialQuery]);

  useEffect(() => {
    const loadSnapshot = async () => {
      try {
        const response = await getMarketSnapshot();
        setMarketSnapshot(response);
      } catch {
        setMarketSnapshot(null);
      }
    };

    void loadSnapshot();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      LOCAL_SETTINGS_KEY,
      JSON.stringify({
        budget,
        riskProfile
      })
    );
  }, [budget, riskProfile]);

  const saveRecentSearch = (entry: RecentSearch) => {
    if (typeof window === "undefined") {
      return;
    }

    const next = [
      entry,
      ...recentSearches.filter((item) => item.query !== entry.query || item.ticker !== entry.ticker)
    ].slice(0, MAX_RECENT_SEARCHES);

    setRecentSearches(next);
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  };

  const persistWatchlist = (next: WatchlistEntry[]) => {
    setWatchlist(next);

    if (typeof window !== "undefined") {
      window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
    }
  };

  const addToWatchlist = (entry: WatchlistEntry) => {
    const normalizedTicker = entry.ticker.trim().toUpperCase();
    if (!normalizedTicker) {
      return;
    }

    const next = [
      { ticker: normalizedTicker, label: entry.label || normalizedTicker },
      ...watchlist.filter((item) => item.ticker.toUpperCase() !== normalizedTicker)
    ].slice(0, MAX_WATCHLIST);

    persistWatchlist(next);
  };

  const removeFromWatchlist = (symbol: string) => {
    const normalizedTicker = symbol.trim().toUpperCase();
    persistWatchlist(watchlist.filter((item) => item.ticker.toUpperCase() !== normalizedTicker));
  };

  const toggleCurrentSymbol = () => {
    if (!activeSymbol) {
      return;
    }

    if (activeSymbolSaved) {
      removeFromWatchlist(activeSymbol);
      return;
    }

    const marketLabel =
      marketSnapshot?.tickers.find((item) => item.symbol.toUpperCase() === activeSymbol)?.name ??
      activeSymbol;

    addToWatchlist({ ticker: activeSymbol, label: marketLabel });
  };

  const applyPrompt = (prompt: { query: string; ticker?: string }) => {
    setQuery(prompt.query);
    setTicker(prompt.ticker ?? extractTicker(prompt.query));
    setError("");
  };

  const applyTickerFocus = (item: { ticker: string; label: string }) => {
    setQuery(buildTickerQuestion(item.ticker, item.label));
    setTicker(item.ticker);
    setError("");
  };

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
      saveRecentSearch({
        label: normalizedTicker || query.slice(0, 24),
        query,
        ticker: normalizedTicker || undefined
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not build your brief right now.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="grid page-shell single-brief-page">
      <article className="card single-brief-hero">
        <div className="single-brief-topline">
          <div>
            <p className="eyebrow">FINITY Briefing Room</p>
            <h1 className="single-brief-title">Ask once, read the full stock brief right here.</h1>
            <p className="single-brief-copy">
              No second page, no hidden report. FINITY runs all three agents and lays out the answer in one clean view,
              with the important numbers up front and the supporting text kept quieter.
            </p>
          </div>

          <div className="single-brief-market-strip">
            <div className="single-market-card">
              <span className="metric-label">Market mood</span>
              <strong>{marketMood}</strong>
              <p className="text-muted">
                {topGainer ? `${topGainer.symbol} leads at ${formatSignedPercent(topGainer.changePercent)}.` : "Waiting for live movers."}
              </p>
            </div>
            <div className="single-market-card">
              <span className="metric-label">Pressure point</span>
              <strong>{topLoser ? topLoser.symbol : "Tracking"}</strong>
              <p className="text-muted">
                {topLoser ? `${formatSignedPercent(topLoser.changePercent)} today.` : "Will appear when market data is ready."}
              </p>
            </div>
          </div>
        </div>

        <form className="single-brief-composer" onSubmit={handleRun}>
          <div className="single-brief-compose-main">
            <label className="label" htmlFor="query">
              What do you want to know today?
            </label>
            <textarea
              className="textarea single-brief-textarea"
              id="query"
              rows={4}
              placeholder="Example: Is Microsoft still a good long-term buy, or should I wait?"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />

            <div className="single-brief-chip-groups">
              <div className="quick-block">
                <span className="metric-label">Quick start</span>
                <div className="chip-row">
                  {quickPrompts.map((prompt) => (
                    <button
                      key={prompt.label}
                      className="quick-chip"
                      onClick={() => applyPrompt(prompt)}
                      type="button"
                    >
                      {prompt.label}
                    </button>
                  ))}
                </div>
              </div>

              {recentSearches.length > 0 && (
                <div className="quick-block">
                  <span className="metric-label">Recent</span>
                  <div className="chip-row">
                    {recentSearches.map((item) => (
                      <button
                        key={`${item.query}-${item.ticker ?? "none"}`}
                        className="recent-chip"
                        onClick={() => applyPrompt(item)}
                        type="button"
                      >
                        <strong>{item.label}</strong>
                        <span>{item.query}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="single-brief-control-rail">
            <div className="single-control-card">
              <label className="label" htmlFor="ticker">
                Ticker
              </label>
              <input
                className="input"
                id="ticker"
                value={ticker}
                placeholder={placeholderTicker || "AAPL"}
                onChange={(event) => setTicker(event.target.value.toUpperCase().replace(/[^A-Z0-9.-]/g, ""))}
              />
              <p className="text-muted">Optional. FINITY can still try to detect the symbol from your question.</p>
            </div>

            <div className="single-control-card">
              <label className="label" htmlFor="budget">
                Amount you may invest
              </label>
              <input
                className="input"
                id="budget"
                min={100}
                step={100}
                type="number"
                value={budget}
                onChange={(event) => setBudget(Number(event.target.value))}
              />
              <p className="text-muted">Used to tailor the risk view for a first-time investor.</p>
            </div>

            <div className="single-control-card">
              <span className="label">Comfort level</span>
              <div className="comfort-grid">
                {comfortOptions.map((option) => (
                  <button
                    key={option.value}
                    className={`comfort-option ${riskProfile === option.value ? "comfort-option-active" : ""}`}
                    onClick={() => setRiskProfile(option.value)}
                    type="button"
                  >
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="single-summary-grid">
              <div className="single-summary-card">
                <span className="metric-label">Amount checked</span>
                <strong>{currency(budget)}</strong>
              </div>
              <div className="single-summary-card">
                <span className="metric-label">Starter size</span>
                <strong>{currency(allocationHint)}</strong>
              </div>
              <div className="single-summary-card">
                <span className="metric-label">Detected symbol</span>
                <strong>{activeSymbol || "We will detect it"}</strong>
              </div>
            </div>

            <div className="button-row single-brief-actions">
              <button className="button button-primary" disabled={!query.trim() || running} type="submit">
                {running ? "Building your brief..." : "Build In-Page Brief"}
              </button>
              {activeSymbol && (
                <button className="button button-secondary" onClick={toggleCurrentSymbol} type="button">
                  {activeSymbolSaved ? "Remove From Radar" : "Save To Radar"}
                </button>
              )}
            </div>
          </div>
        </form>
      </article>

      {error && (
        <article className="card danger-card">
          <p style={{ margin: 0 }}>{error}</p>
        </article>
      )}

      {result && (
        <>
          <section className="card single-brief-results">
            <div className="single-results-header">
              <div>
                <p className="eyebrow">Your in-page brief</p>
                <h2 className="single-results-title">{briefHeadline(result, activeSymbol)}</h2>
                <p className="single-results-copy">{briefSummary(result)}</p>
              </div>
              <div className="single-results-badges">
                <span className={`trend-chip ${briefToneClass(result)}`}>{result.risk_manager.suitability}</span>
                <span className={`trend-chip ${result.estimated ? "trend-flat" : "trend-up"}`}>
                  {result.estimated ? "Estimated data" : "Live-backed flow"}
                </span>
              </div>
            </div>

            <div className="single-results-hero-grid">
              <div className="single-verdict-card">
                <span className="metric-label">Main takeaway</span>
                <strong>{result.risk_manager.action}</strong>
                <p className="text-muted">{result.risk_manager.risk_note}</p>
              </div>

              <div className="single-highlight-strip">
                <MetricInfoPopover explanation={result.analyst.pe_context} label="P/E" value={result.analyst.pe_ratio} />
                <MetricInfoPopover
                  explanation={result.analyst.ai_confidence_context}
                  label="AI confidence"
                  value={`${result.analyst.ai_confidence} / 100`}
                />
                <MetricInfoPopover
                  explanation="Shows how much the positive and negative evidence disagree right now."
                  label="Bull vs Bear"
                  value={`${result.researcher.bull_ratio} / ${result.researcher.bear_ratio}`}
                />
              </div>
            </div>

            <div className="single-agent-grid">
              <article className="single-agent-card">
                <p className="eyebrow">Agent 1</p>
                <h3>Researcher</h3>
                <div className="single-agent-stat">{result.researcher.sentiment}</div>
                <p className="single-agent-subtle">{result.researcher.sentiment_confidence}% confidence from current research signals.</p>
                <div className="single-inline-metrics">
                  <div>
                    <span className="metric-label">Bull case</span>
                    <strong>{result.researcher.bull_ratio}%</strong>
                  </div>
                  <div>
                    <span className="metric-label">Bear case</span>
                    <strong>{result.researcher.bear_ratio}%</strong>
                  </div>
                </div>
                <div className="single-signal-list">
                  {result.researcher.top_signals.map((signal) => (
                    <div key={signal} className="single-signal-item">
                      <span className="single-signal-dot" />
                      <span className="text-muted">{signal}</span>
                    </div>
                  ))}
                </div>
              </article>

              <article className="single-agent-card">
                <p className="eyebrow">Agent 2</p>
                <h3>Analyst</h3>
                <div className="single-agent-stat">{result.analyst.momentum_5d}</div>
                <p className="single-agent-subtle">{result.analyst.momentum_context}</p>
                <div className="single-agent-detail-block">
                  <div>
                    <span className="metric-label">Outlook</span>
                    <strong>{result.analyst.outlook}</strong>
                    <p className="text-muted">{result.analyst.outlook_timeframe}</p>
                  </div>
                  <div>
                    <span className="metric-label">Valuation</span>
                    <strong>{result.analyst.pe_ratio}</strong>
                    <p className="text-muted">{result.analyst.pe_context}</p>
                  </div>
                </div>
              </article>

              <article className="single-agent-card">
                <p className="eyebrow">Agent 3</p>
                <h3>Risk manager</h3>
                <div className="single-agent-stat">{result.risk_manager.suitability}</div>
                <p className="single-agent-subtle">{result.risk_manager.opportunity_note}</p>
                <div className="single-agent-note-stack">
                  <div className="single-note-card">
                    <span className="metric-label">Risk note</span>
                    <p className="text-muted">{result.risk_manager.risk_note}</p>
                  </div>
                  <div className="single-note-card single-note-card-accent">
                    <span className="metric-label">What to do today</span>
                    <strong>{result.risk_manager.action}</strong>
                  </div>
                </div>
              </article>
            </div>
          </section>

          <AgentStatusCard
            statuses={[
              { agent: "Researcher", state: "completed", message: `${result.researcher.sentiment} sentiment ready` },
              { agent: "Analyst", state: "completed", message: `${result.analyst.outlook} outlook for ${result.analyst.outlook_timeframe}` },
              { agent: "Risk Manager", state: "completed", message: result.risk_manager.suitability }
            ]}
          />
        </>
      )}

      <section className="single-bottom-grid">
        <article className="card single-radar-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Saved radar</p>
              <h2>Names you want to revisit</h2>
            </div>
          </div>

          {watchlistCards.length === 0 ? (
            <div className="empty-state">
              <strong>No saved names yet</strong>
              <p className="text-muted">Save a ticker from the form above and it will stay here for quick access.</p>
            </div>
          ) : (
            <div className="single-radar-grid">
              {watchlistCards.map((item) => (
                <article key={item.ticker} className="single-radar-card">
                  <div className="focus-card-top">
                    <div>
                      <strong>{item.ticker}</strong>
                      <p className="text-muted">{item.label}</p>
                    </div>
                    {item.quote ? (
                      <span className={item.quote.changePercent >= 0 ? "trend-chip trend-up" : "trend-chip trend-down"}>
                        {formatSignedPercent(item.quote.changePercent)}
                      </span>
                    ) : (
                      <span className="badge badge-ghost">Saved</span>
                    )}
                  </div>

                  <p className="focus-price">
                    {item.quote ? `Last close ${currency(item.quote.lastClose)}` : "Saved for quick one-tap access"}
                  </p>

                  <div className="mini-button-row">
                    <button className="inline-button" onClick={() => applyTickerFocus({ ticker: item.ticker, label: item.label })} type="button">
                      Build brief
                    </button>
                    <button className="inline-button inline-button-muted" onClick={() => removeFromWatchlist(item.ticker)} type="button">
                      Remove
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </article>

        <article className="card single-market-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Market pulse</p>
              <h2>What is moving around you</h2>
            </div>
          </div>

          <div className="single-market-pulse-grid">
            {movers.map((item) => (
              <button key={item.symbol} className="single-mover-card" onClick={() => applyTickerFocus({ ticker: item.symbol, label: item.name })} type="button">
                <span className="metric-label">{item.symbol}</span>
                <strong>{formatSignedPercent(item.changePercent)}</strong>
                <p className="text-muted">{item.name}</p>
              </button>
            ))}
            {movers.length === 0 && (
              <div className="empty-state">
                <strong>Loading market pulse</strong>
                <p className="text-muted">Live movers will appear here when market data is available.</p>
              </div>
            )}
          </div>
        </article>
      </section>
    </section>
  );
}
