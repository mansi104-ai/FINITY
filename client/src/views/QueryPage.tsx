"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getMarketHistory, getMarketSnapshot, getStockDetail, searchStocks, sendQuery,
  getSessionUser, subscribeToAuthChanges, type StockSearchResult,
} from "../services/api";
import type { MarketHistory, MarketSnapshot, QueryResponse, RiskProfile, StockQuote } from "../types";

const LOCAL_SETTINGS_KEY = "findec-local-settings";

function extractTicker(query: string): string {
  const dollarMatch = query.toUpperCase().match(/\$([A-Z][A-Z0-9.-]{0,14})\b/);
  if (dollarMatch?.[1]) return dollarMatch[1];
  const symbolMatch = query.toUpperCase().match(/\b[A-Z][A-Z0-9.-]{0,14}\b/);
  return symbolMatch?.[0] ?? "";
}

function formatSignedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}
function compactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: value >= 100 ? 0 : 1 }).format(value);
}
function fmtMoney(value: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: value >= 100 ? 0 : 2 }).format(value);
  } catch {
    return value.toLocaleString();
  }
}

function defaultMarketCards(snapshot: MarketSnapshot | null) {
  const t = snapshot?.tickers ?? [];
  return t.slice(0, 4).map((q) => ({
    label: q.symbol,
    value: compactNumber(q.lastClose),
    subtext: `${formatSignedPercent(q.changePercent)} today`,
    tone: (q.changePercent >= 0 ? "up" : "down") as "up" | "down",
  }));
}

function suitabilityTone(value: QueryResponse["risk_manager"]["suitability"]): string {
  if (value === "Suited for you") return "findec-tag-green";
  if (value === "Not suited") return "findec-tag-red";
  return "findec-tag-amber";
}

function toChartPoints(points: MarketHistory["points"], width: number, height: number): string {
  if (points.length === 0) return "";
  const closes = points.map((p) => p.close);
  const min = Math.min(...closes), max = Math.max(...closes);
  const range = Math.max(max - min, 1);
  return points.map((p, i) => {
    const x = (i / Math.max(points.length - 1, 1)) * width;
    const y = height - ((p.close - min) / range) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function marketMoodCopy(change1d?: number, change30d?: number): string {
  if (typeof change1d === "number" && change1d >= 1.2) return "Market mood is strongly positive for this stock today";
  if (typeof change1d === "number" && change1d <= -1.2) return "Market mood is cautious for this stock today";
  if (typeof change30d === "number" && change30d >= 6) return "Market mood stays constructive after a strong month";
  if (typeof change30d === "number" && change30d <= -6) return "Market mood remains fragile after a weak month";
  return "Market mood is steady for this stock today";
}

function liveActionText(baseAction: string, history: MarketHistory | null, dayMove?: number): string {
  if (!history) return baseAction;
  const dayText = typeof dayMove === "number" ? `${dayMove >= 0 ? "+" : ""}${dayMove.toFixed(1)}% today` : "today";
  const monthText = `${history.changePercent30d >= 0 ? "+" : ""}${history.changePercent30d.toFixed(1)}% over 30 days`;
  return `${baseAction} ${dayText}; ${monthText}.`;
}

const RISK_OPTIONS: Array<{ key: RiskProfile; label: string }> = [
  { key: "low", label: "Low / Conservative" },
  { key: "medium", label: "Medium / Balanced" },
  { key: "high", label: "High / Aggressive" },
];

export default function QueryPage({ initialTicker = "", initialQuery = "" }: { initialTicker?: string; initialQuery?: string }) {
  const [query, setQuery] = useState("");
  const [ticker, setTicker] = useState("");
  const [budget, setBudget] = useState(10000);
  const [riskProfile, setRiskProfile] = useState<RiskProfile>("medium");
  const [signedIn, setSignedIn] = useState(false);
  const [suggestions, setSuggestions] = useState<StockSearchResult[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [marketSnapshot, setMarketSnapshot] = useState<MarketSnapshot | null>(null);
  const [marketHistory, setMarketHistory] = useState<MarketHistory | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [latestReportId, setLatestReportId] = useState("");
  const [stockFundamentals, setStockFundamentals] = useState<StockQuote | null>(null);
  const hydratedRef = useRef("");
  const lastRunRef = useRef("");
  const searchWrapRef = useRef<HTMLDivElement>(null);

  // Active ticker = explicit selection, else a symbol parsed from the query. No hardcoded default.
  const activeTicker = useMemo(() => (ticker || extractTicker(query)).trim().toUpperCase(), [ticker, query]);
  const currency = stockFundamentals?.currency || marketHistory?.currency || "USD";
  const displaySymbol = stockFundamentals?.name || activeTicker || "—";
  const activeQuote = useMemo(
    () => marketSnapshot?.tickers.find((i) => i.symbol.toUpperCase() === activeTicker) ?? null,
    [activeTicker, marketSnapshot]
  );
  const marketCards = useMemo(() => defaultMarketCards(marketSnapshot), [marketSnapshot]);

  useEffect(() => {
    const sync = () => setSignedIn(getSessionUser() !== null);
    sync();
    return subscribeToAuthChanges(sync);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(LOCAL_SETTINGS_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { budget?: number; riskProfile?: RiskProfile };
        if (typeof parsed.budget === "number") setBudget(parsed.budget);
        if (parsed.riskProfile) setRiskProfile(parsed.riskProfile);
      } catch { window.localStorage.removeItem(LOCAL_SETTINGS_KEY); }
    }
  }, []);

  const persistSettings = useCallback((b: number, r: RiskProfile) => {
    if (typeof window !== "undefined") window.localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify({ budget: b, riskProfile: r }));
  }, []);

  const runBrief = useCallback(async (q: string, tk: string) => {
    if (!getSessionUser()) { setError("Sign in to generate an AI brief."); return; }
    const runKey = `${tk}|${q}|${riskProfile}|${budget}`;
    if (running && lastRunRef.current === runKey) return;
    lastRunRef.current = runKey;
    setRunning(true); setError("");
    try {
      const response = await sendQuery({ query: q || `What is the outlook for ${tk} today?`, ticker: tk || undefined, budget, riskProfile, version: 4 });
      setResult(response);
      setLatestReportId(response.reportId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not build your brief right now.");
    } finally {
      setRunning(false);
    }
  }, [budget, riskProfile, running]);

  // Hydrate from props (/brief?ticker=X) and auto-run once when signed in.
  useEffect(() => {
    const tk = initialTicker.trim().toUpperCase();
    const q = initialQuery.trim();
    const key = `${tk}::${q}`;
    if (hydratedRef.current === key) return;
    hydratedRef.current = key;
    if (q) { setQuery(q); setTicker(tk || extractTicker(q)); }
    else if (tk) { setTicker(tk); setQuery(`What is the outlook for ${tk} today?`); }
    if (tk && getSessionUser()) void runBrief(q || `What is the outlook for ${tk} today?`, tk);
  }, [initialQuery, initialTicker, runBrief]);

  useEffect(() => { void getMarketSnapshot().then(setMarketSnapshot).catch(() => setMarketSnapshot(null)); }, []);

  useEffect(() => {
    if (!activeTicker || activeTicker.startsWith("^")) { setMarketHistory(null); return; }
    void getMarketHistory(activeTicker).then(setMarketHistory).catch(() => setMarketHistory(null));
  }, [activeTicker]);

  useEffect(() => {
    if (!activeTicker || activeTicker.startsWith("^")) { setStockFundamentals(null); return; }
    void getStockDetail(activeTicker).then(setStockFundamentals).catch(() => setStockFundamentals(null));
  }, [activeTicker]);

  // Live ticker autocomplete (resolves company names → real symbols, e.g. "visa" → V).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setSuggestions([]); return; }
    const handle = setTimeout(() => {
      void searchStocks(q).then((r) => setSuggestions(r.results.slice(0, 6))).catch(() => setSuggestions([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!searchWrapRef.current?.contains(e.target as Node)) setShowSuggest(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const chartPolyline = useMemo(() => (marketHistory ? toChartPoints(marketHistory.points, 760, 180) : ""), [marketHistory]);

  const pickSuggestion = (s: StockSearchResult) => {
    setTicker(s.symbol);
    setQuery(`What is the outlook for ${s.name} (${s.symbol}) today?`);
    setShowSuggest(false);
    setSuggestions([]);
    void runBrief(`What is the outlook for ${s.name} (${s.symbol}) today?`, s.symbol); // #7 auto-brief on ticker add
  };

  const handleRun = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setShowSuggest(false);
    let tk = ticker.trim().toUpperCase();
    // Resolve a real ticker from the query text when none is explicitly chosen (#1 fix).
    if (!tk) {
      try {
        const r = await searchStocks(query.trim());
        if (r.results[0]) { tk = r.results[0].symbol; setTicker(tk); }
      } catch { /* fall through */ }
    }
    await runBrief(query, tk);
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
        <form className="findec-search-row" onSubmit={handleRun} autoComplete="off">
          <div className="findec-search-wrap" ref={searchWrapRef}>
            <input
              className="findec-search-input"
              placeholder="search a company or ticker — e.g. Visa, AAPL, Reliance..."
              value={query}
              onChange={(e) => { setQuery(e.target.value); setTicker(""); setShowSuggest(true); }}
              onFocus={() => setShowSuggest(true)}
            />
            {showSuggest && suggestions.length > 0 && (
              <div className="findec-suggest">
                {suggestions.map((s) => (
                  <button type="button" key={`${s.symbol}-${s.exchange}`} className="findec-suggest-row" onClick={() => pickSuggestion(s)}>
                    <strong>{s.symbol}</strong>
                    <span>{s.name}</span>
                    <em>{s.exchange}</em>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="findec-search-button" disabled={!query.trim() || running} type="submit">
            {running ? "..." : "brief ->"}
          </button>
        </form>

        {/* Investment profile controls (#4 editable) */}
        <section className="findec-panel brief-profile">
          <div className="brief-profile-group">
            <span className="findec-kicker">Risk profile</span>
            <div className="brief-risk-toggle">
              {RISK_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  className={`adv-chip ${riskProfile === o.key ? "adv-chip-on" : ""}`}
                  onClick={() => { setRiskProfile(o.key); persistSettings(budget, o.key); }}
                >{o.label}</button>
              ))}
            </div>
          </div>
          <div className="brief-profile-group">
            <span className="findec-kicker">Budget ({currency})</span>
            <input
              className="alert-input"
              type="number" min={100} step={100}
              value={budget}
              onChange={(e) => { const b = Number(e.target.value) || 0; setBudget(b); persistSettings(b, riskProfile); }}
            />
          </div>
        </section>

        {marketCards.length > 0 && (
          <section className="findec-market-grid">
            {marketCards.map((card) => (
              <article key={card.label} className="findec-panel findec-metric-panel">
                <p className="findec-kicker">{card.label}</p>
                <strong>{card.value}</strong>
                <span className={`findec-subline findec-subline-${card.tone}`}>{card.subtext}</span>
              </article>
            ))}
          </section>
        )}

        {error && <section className="findec-panel findec-error-panel"><p>{error}</p>{!signedIn && <Link href="/login" className="findec-inline-link-button">Login →</Link>}</section>}

        {activeTicker && (
          <section className="findec-panel findec-chart-panel">
            <div className="findec-chart-top">
              <div>
                <p className="findec-kicker">30 day price graph · {displaySymbol}</p>
                <strong className="findec-chart-price">{marketHistory ? fmtMoney(marketHistory.latestClose, currency) : "—"}</strong>
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
                  <strong>{marketHistory ? `${fmtMoney(marketHistory.high30d, currency)} / ${fmtMoney(marketHistory.low30d, currency)}` : "—"}</strong>
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
              {!marketHistory && <p className="text-muted" style={{ padding: "0.5rem" }}>Live 30-day history is unavailable for {activeTicker} right now.</p>}
            </div>
          </section>
        )}

        {stockFundamentals && (
          <section className="findec-panel findec-fundamentals-panel">
            <p className="findec-kicker">Fundamentals · {stockFundamentals.name}</p>
            <div className="findec-fund-grid">
              {stockFundamentals.marketCap != null && <div className="findec-fund-item"><span>Market Cap</span><strong>{fmtCap(stockFundamentals.marketCap)}</strong></div>}
              {stockFundamentals.peRatio != null && <div className="findec-fund-item"><span>P/E (TTM)</span><strong>{stockFundamentals.peRatio}</strong></div>}
              {stockFundamentals.forwardPE != null && <div className="findec-fund-item"><span>Forward P/E</span><strong>{stockFundamentals.forwardPE}</strong></div>}
              {stockFundamentals.eps != null && <div className="findec-fund-item"><span>EPS (TTM)</span><strong>{stockFundamentals.eps}</strong></div>}
              {stockFundamentals.dividendYield != null && <div className="findec-fund-item"><span>Div Yield</span><strong>{stockFundamentals.dividendYield.toFixed(2)}%</strong></div>}
              {stockFundamentals.beta != null && <div className="findec-fund-item"><span>Beta</span><strong>{stockFundamentals.beta}</strong></div>}
              {stockFundamentals.priceToBook != null && <div className="findec-fund-item"><span>P/B Ratio</span><strong>{stockFundamentals.priceToBook}</strong></div>}
              {stockFundamentals.volume != null && <div className="findec-fund-item"><span>Volume</span><strong>{(stockFundamentals.volume / 1e6).toFixed(1)}M</strong></div>}
            </div>
            {stockFundamentals.high52w != null && stockFundamentals.low52w != null && (
              <div className="findec-fund-52w">
                <span className="findec-fund-52w-label">52-Week Range</span>
                <div className="findec-fund-52w-bar">
                  <span className="findec-fund-52w-lo">{stockFundamentals.low52w.toLocaleString()}</span>
                  <div className="findec-fund-52w-track">
                    <div className="findec-fund-52w-dot" style={{ left: `${posIn52w(stockFundamentals.price, stockFundamentals.low52w, stockFundamentals.high52w)}%` }} />
                  </div>
                  <span className="findec-fund-52w-hi">{stockFundamentals.high52w.toLocaleString()}</span>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Results only render after a real brief runs — no hardcoded sample company. */}
        {!result && !running && (
          <section className="findec-panel findec-empty-brief">
            <p className="findec-kicker">AI Brief</p>
            <p className="text-muted">{signedIn ? "Search a company or ticker above to generate a live AI brief." : "Sign in, then search a company to generate a live AI brief."}</p>
            <p className="text-muted" style={{ fontSize: "0.8rem", marginTop: "0.4rem" }}>
              Free plan: 4 AI briefs/day · <Link href="/pricing" className="legal-inline-link">Pro</Link> unlocks unlimited.
            </p>
          </section>
        )}
        {running && !result && <section className="findec-panel"><p className="findec-kicker">Building your brief for {displaySymbol}…</p></section>}

        {result && (
          <>
            <section className="findec-results-grid">
              <article className="findec-panel findec-agent-panel">
                <p className="findec-kicker">Researcher agent · {displaySymbol}</p>
                <div className="findec-agent-head">
                  <div>
                    <span className={`findec-tag ${result.researcher.sentiment === "Bullish" ? "findec-tag-green" : result.researcher.sentiment === "Bearish" ? "findec-tag-red" : "findec-tag-amber"}`}>
                      {result.researcher.sentiment}
                    </span>
                    <p className="findec-copy">{marketMoodCopy(activeQuote?.changePercent, marketHistory?.changePercent30d)}</p>
                  </div>
                  <strong className="findec-big-score">{result.researcher.sentiment_confidence}%</strong>
                </div>
                <div className="findec-section-line" />
                <div className="findec-bar-labels"><span>Bull</span><span>Bear</span></div>
                <div className="findec-sentiment-bar">
                  <div className="findec-sentiment-bull" style={{ width: `${result.researcher.bull_ratio}%` }} />
                  <div className="findec-sentiment-bear" style={{ width: `${result.researcher.bear_ratio}%` }} />
                </div>
                <div className="findec-bar-values"><span>{result.researcher.bull_ratio}</span><span>{result.researcher.bear_ratio}</span></div>
                <div className="findec-bullet-list">
                  {result.researcher.top_signals.map((signal) => <p key={signal}>- {signal}</p>)}
                </div>
              </article>

              <article className="findec-panel findec-agent-panel">
                <p className="findec-kicker">Analyst agent · {displaySymbol}</p>
                <div className="findec-info-block"><span>P/E Ratio</span><strong>{result.analyst.pe_ratio}</strong><p>{result.analyst.pe_context}</p></div>
                <div className="findec-info-block"><span>5-day momentum</span><strong>{result.analyst.momentum_5d}</strong><p>{result.analyst.momentum_context}</p></div>
                <div className="findec-info-block"><span>AI confidence</span><strong>{result.analyst.ai_confidence} / 100</strong><p>{result.analyst.ai_confidence_context}</p></div>
                <div className="findec-info-block findec-info-block-last">
                  <span>Short term outlook</span>
                  <div className="findec-tag-row"><span className="findec-tag findec-tag-green">{result.analyst.outlook} · {result.analyst.outlook_timeframe}</span></div>
                </div>
              </article>
            </section>

            <section className="findec-panel findec-risk-panel">
              <p className="findec-kicker">Risk manager · {displaySymbol} · your profile: {riskProfile.toUpperCase()} risk</p>
              <div className="findec-risk-grid">
                <div>
                  <span>Suitability</span>
                  <div className="findec-tag-row"><span className={`findec-tag ${suitabilityTone(result.risk_manager.suitability)}`}>{result.risk_manager.suitability}</span></div>
                </div>
                <div><span>Watch out for</span><strong>{result.risk_manager.risk_note}</strong></div>
                <div><span>Opportunity</span><strong>{result.risk_manager.opportunity_note}</strong></div>
              </div>
            </section>

            <section className="findec-action-banner">
              <p className="findec-kicker">What to do today</p>
              <strong>{liveActionText(result.risk_manager.action, marketHistory, activeQuote?.changePercent)}</strong>
              <p className="findec-disclaimer-text">{result.disclaimer}</p>
              {latestReportId && (
                <div className="findec-inline-actions">
                  <Link className="findec-inline-link-button" href={`/report/${latestReportId}`}>Open saved report</Link>
                  <Link className="findec-inline-link-button findec-inline-link-button-muted" href="/history">View report archive</Link>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </section>
  );
}
