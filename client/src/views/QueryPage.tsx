"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import MarketTickerStrip from "../components/MarketTickerStrip";
import { getMarketSnapshot, sendQuery } from "../services/api";
import type { MarketSnapshot, QueryResponse, RiskProfile } from "../types";
import AgentStatusCard from "../components/AgentStatusCard";
import ReportCard from "../components/ReportCard";

const LOCAL_SETTINGS_KEY = "finity-local-settings";
const RECENT_SEARCHES_KEY = "finity-recent-searches";
const WATCHLIST_KEY = "finity-watchlist";
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

export default function QueryPage() {
  const [query, setQuery] = useState("");
  const [ticker, setTicker] = useState("");
  const [budget, setBudget] = useState(10000);
  const [riskProfile, setRiskProfile] = useState<RiskProfile>("medium");
  const [version, setVersion] = useState(2);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [marketSnapshot, setMarketSnapshot] = useState<MarketSnapshot | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<QueryResponse | null>(null);

  const placeholderTicker = useMemo(() => extractTicker(query), [query]);
  const allocationHint = useMemo(() => Math.round(budget * 0.08), [budget]);
  const comfortLabel = useMemo(
    () => comfortOptions.find((option) => option.value === riskProfile)?.label ?? "Balanced",
    [riskProfile]
  );

  const activeSymbol = useMemo(
    () => (result?.report.ticker || ticker || placeholderTicker || "").trim().toUpperCase(),
    [placeholderTicker, result?.report.ticker, ticker]
  );

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
      result?.report.ticker ??
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
        version
      });

      setResult(response);
      saveRecentSearch({
        label: response.report.ticker || normalizedTicker || query.slice(0, 24),
        query,
        ticker: response.report.ticker || normalizedTicker || undefined
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not build your brief right now.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="grid page-shell">
      <MarketTickerStrip />

      <article className="hero-panel">
        <div>
          <p className="eyebrow">Daily Market Check-In</p>
          <h1 className="hero-title">Start the day with a simple answer.</h1>
          <p className="hero-copy">
            Ask about a stock, fund, or company in plain English. FINITY turns it into a short daily brief with a clear
            next step.
          </p>
        </div>
        <div className="hero-strip">
          <div className="metric-card">
            <span className="metric-label">Speak naturally</span>
            <strong>Company names work too</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Comfort level</span>
            <strong>{comfortLabel}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Starter amount</span>
            <strong>{currency(allocationHint)}</strong>
          </div>
        </div>
      </article>

      <div className="grid daily-routine-grid">
        <article className="card morning-brief-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Command Center</p>
              <h2>What matters right now</h2>
            </div>
            <p className="text-muted">A quick dashboard for daily discovery, saved names, and one-tap follow-ups.</p>
          </div>

          <div className="grid grid-3">
            <div className="metric-card">
              <span className="metric-label">Market mood</span>
              <strong>{marketMood}</strong>
            </div>
            <div className="metric-card">
              <span className="metric-label">Best mover</span>
              <strong>{topGainer ? `${topGainer.symbol} ${formatSignedPercent(topGainer.changePercent)}` : "Loading"}</strong>
            </div>
            <div className="metric-card">
              <span className="metric-label">Weakest mover</span>
              <strong>{topLoser ? `${topLoser.symbol} ${formatSignedPercent(topLoser.changePercent)}` : "Loading"}</strong>
            </div>
          </div>

          <div className="focus-list">
            {movers.map((item) => (
              <article key={item.symbol} className="focus-card">
                <div className="focus-card-top">
                  <div>
                    <strong>{item.symbol}</strong>
                    <p className="text-muted">{item.name}</p>
                  </div>
                  <span className={item.changePercent >= 0 ? "trend-chip trend-up" : "trend-chip trend-down"}>
                    {formatSignedPercent(item.changePercent)}
                  </span>
                </div>
                <p className="focus-price">Last close {currency(item.lastClose)}</p>
                <div className="mini-button-row">
                  <button className="inline-button" onClick={() => applyTickerFocus({ ticker: item.symbol, label: item.name })} type="button">
                    Use In Brief
                  </button>
                  <button className="inline-button inline-button-muted" onClick={() => addToWatchlist({ ticker: item.symbol, label: item.name })} type="button">
                    Save To Radar
                  </button>
                </div>
              </article>
            ))}
          </div>
        </article>

        <article className="card radar-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Saved Radar</p>
              <h2>Your daily list</h2>
            </div>
            <p className="text-muted">Pin names you want to revisit every morning.</p>
          </div>

          {watchlistCards.length === 0 ? (
            <div className="empty-state">
              <strong>No saved names yet</strong>
              <p className="text-muted">Use "Save To Radar" on a mover or after a search result to build your own daily dashboard.</p>
            </div>
          ) : (
            <div className="watchlist-grid">
              {watchlistCards.map((item) => (
                <article key={item.ticker} className="watchlist-card">
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
                      Open Brief
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
      </div>

      <article className="card trade-ticket compact-ticket">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Today&apos;s Question</p>
            <h2>Your daily brief</h2>
          </div>
          <p className="text-muted">Use one tap to start, or ask your own question below.</p>
        </div>

        <div className="quick-tools">
          <div className="quick-block">
            <span className="metric-label">Quick Start</span>
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

        <form onSubmit={handleRun}>
          <div className="form-row">
            <label className="label" htmlFor="query">
              What do you want to know today?
            </label>
            <textarea
              className="textarea"
              id="query"
              rows={3}
              placeholder="Example: Is Microsoft still a good long-term buy, or should I wait?"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <p className="form-hint">You can type a company name, ticker, or a full question. Example: Apple, TSLA, or "Should I buy Nvidia now?"</p>
          </div>

          <div className="grid grid-2 compact-grid">
            <div className="form-row">
              <label className="label" htmlFor="ticker">
                Ticker (optional)
              </label>
              <input
                className="input"
                id="ticker"
                value={ticker}
                placeholder={placeholderTicker || "AAPL"}
                onChange={(event) => setTicker(event.target.value.toUpperCase().replace(/[^A-Z0-9.-]/g, ""))}
              />
            </div>

            <div className="form-row">
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
            </div>
          </div>

          <div className="form-row">
            <span className="label">Your comfort level</span>
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

          <details className="advanced-panel">
            <summary className="details-summary">
              <span>Advanced options</span>
            </summary>

            <div className="grid grid-2 advanced-grid">
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label className="label" htmlFor="version">
                  Analysis engine
                </label>
                <select
                  className="select"
                  id="version"
                  value={version}
                  onChange={(event) => setVersion(Number(event.target.value))}
                >
                  <option value={1}>V1 | Research only</option>
                  <option value={2}>V2 | Research + analyst</option>
                  <option value={3}>V3 | Policy weighted</option>
                  <option value={4}>V4 | Full orchestration</option>
                </select>
              </div>
            </div>
          </details>

          <div className="ticket-summary">
            <div className="ticket-kpi">
              <span className="metric-label">Amount checked</span>
              <strong>{currency(budget)}</strong>
            </div>
            <div className="ticket-kpi">
              <span className="metric-label">Suggested starting size</span>
              <strong>{currency(allocationHint)}</strong>
            </div>
            <div className="ticket-kpi">
              <span className="metric-label">Detected symbol</span>
              <strong>{activeSymbol || "We will detect it for you"}</strong>
            </div>
          </div>

          <div className="button-row">
            <button className="button button-primary" disabled={!query.trim() || running} type="submit">
              {running ? "Building your brief..." : "Get Today&apos;s Brief"}
            </button>
            {activeSymbol && (
              <button className="button button-secondary" onClick={toggleCurrentSymbol} type="button">
                {activeSymbolSaved ? "Remove From Radar" : "Save To Radar"}
              </button>
            )}
            {result && (
              <Link className="button button-secondary" href={`/report/${result.reportId}`}>
                Open Full Report
              </Link>
            )}
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
          <ReportCard report={result.report} />
          <AgentStatusCard statuses={result.report.agentLogs} />
        </>
      )}
    </section>
  );
}
