"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MetricInfoPopover } from "../components/MetricInfoPopover";
import { getMarketSnapshot } from "../services/api";
import type { MarketSnapshot } from "../types";

type FocusCard = {
  ticker: string;
  company: string;
  move: string;
  catalyst: string;
  action: string;
};

const commandShortcuts = [
  "Summarize overnight news for my watchlist",
  "Why is NVIDIA moving today?",
  "Show me the bull vs bear case for Apple",
  "Explain P/E ratio like I'm new to investing"
];

const focusCards: FocusCard[] = [
  {
    ticker: "AAPL",
    company: "Apple",
    move: "+1.8%",
    catalyst: "Services resilience offsets softer hardware sentiment.",
    action: "Open AI thesis"
  },
  {
    ticker: "NVDA",
    company: "NVIDIA",
    move: "+2.6%",
    catalyst: "AI infrastructure spend remains the lead narrative into earnings.",
    action: "Map risk factors"
  },
  {
    ticker: "TSLA",
    company: "Tesla",
    move: "-1.2%",
    catalyst: "Margin pressure remains the first question in the morning tape.",
    action: "Why did this drop?"
  }
];

const agentTimeline = [
  {
    agent: "Researcher",
    status: "Running",
    note: "Scanning overnight news, filings, and social chatter for names on your radar."
  },
  {
    agent: "Analyst",
    status: "Queued",
    note: "Will translate raw evidence into bull, base, and bear pathways with confidence."
  },
  {
    agent: "Risk Manager",
    status: "Ready",
    note: "Position sizing and alert thresholds wait on the analyst confidence band."
  }
];

function formatSignedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatMarketClock(asOf: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric"
  }).format(new Date(asOf));
}

export default function WorkspaceHome() {
  const [marketSnapshot, setMarketSnapshot] = useState<MarketSnapshot | null>(null);

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

  const headlineTicker = useMemo(() => {
    if (!marketSnapshot?.tickers?.length) {
      return null;
    }

    return [...marketSnapshot.tickers].sort((left, right) => Math.abs(right.changePercent) - Math.abs(left.changePercent))[0] ?? null;
  }, [marketSnapshot]);

  const watchlistPreview = useMemo(() => {
    return marketSnapshot?.tickers.slice(0, 4) ?? [];
  }, [marketSnapshot]);

  return (
    <section className="workspace-shell">
      <article className="workspace-hero">
        <div>
          <p className="eyebrow">FINDEC v0.0.2</p>
          <h1 className="workspace-title">Conversational dashboarding for retail investors who want answers, not noise.</h1>
          <p className="workspace-copy">
            This release reframes FINDEC around a split-pane market workspace: familiar charts and watchlists on the left, an always-contextual AI copilot on the right.
          </p>
        </div>

        <div className="workspace-chip-row">
          <span className="workspace-chip">Morning dashboard</span>
          <span className="workspace-chip">Contextual copilot</span>
          <span className="workspace-chip">Visual-first analysis</span>
        </div>
      </article>

      <div className="splitpane-layout">
        <div className="workspace-main">
          <section className="workspace-card workspace-morning-board">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Morning Dashboard</p>
                <h2>What changed for your names before the open</h2>
              </div>
              <p className="text-muted">
                {marketSnapshot ? `Synced ${formatMarketClock(marketSnapshot.asOf)} | ${marketSnapshot.market.label}` : "Waiting for live market snapshot"}
              </p>
            </div>

            <div className="workspace-kpi-grid">
              <MetricInfoPopover
                explanation="Price to earnings compares a stock's valuation with the profit it generates. Higher is not always bad, but it usually means investors expect faster growth."
                label="P/E"
                value="25.4"
              />
              <MetricInfoPopover
                explanation="The confidence band shows how strongly FINDEC's agents agree after combining news, price structure, and portfolio risk limits."
                label="AI confidence"
                value="78 / 100"
              />
              <MetricInfoPopover
                explanation="Bull vs Bear measures how balanced the upside and downside evidence looks right now, so you can tell whether the argument is one-sided or contested."
                label="Bull vs Bear"
                value="60 / 40"
              />
            </div>

            <div className="workspace-grid-two">
              <article className="workspace-subcard">
                <div className="workspace-subcard-header">
                  <div>
                    <p className="eyebrow">Personalized Brief</p>
                    <h3>Your portfolio narrative</h3>
                  </div>
                  <span className="badge badge-ghost">Hyper-personalized</span>
                </div>
                <p className="workspace-brief-copy">
                  The morning stack is leaning constructive. Mega-cap tech remains the leadership group, while auto and rate-sensitive names still need tighter risk framing before new entries.
                </p>
                <ul className="workspace-list">
                  <li>Apple and Microsoft remain steadier holdings for lower-volatility capital.</li>
                  <li>NVIDIA keeps the highest upside narrative, but the AI copilot should frame event risk before sizing up.</li>
                  <li>Tesla needs a catalyst-based explanation before any aggressive buy decision.</li>
                </ul>
              </article>

              <article className="workspace-subcard workspace-chart-card">
                <div className="workspace-subcard-header">
                  <div>
                    <p className="eyebrow">Visual Summary</p>
                    <h3>Conviction gauge</h3>
                  </div>
                  <span className="workspace-mini-label">Bullish skew</span>
                </div>
                <div className="workspace-gauge">
                  <div className="workspace-gauge-ring" />
                  <div className="workspace-gauge-center">
                    <strong>78%</strong>
                    <span>Confidence</span>
                  </div>
                </div>
                <p className="text-muted">Designed to replace long text blobs with an instant read on signal strength.</p>
              </article>
            </div>
          </section>

          <section className="workspace-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Focus Radar</p>
                <h2>Names that deserve a one-tap deep dive</h2>
              </div>
              {headlineTicker && (
                <span className={headlineTicker.changePercent >= 0 ? "trend-chip trend-up" : "trend-chip trend-down"}>
                  {headlineTicker.symbol} {formatSignedPercent(headlineTicker.changePercent)}
                </span>
              )}
            </div>

            <div className="workspace-focus-grid">
              {focusCards.map((item) => (
                <article key={item.ticker} className="workspace-focus-card">
                  <div className="workspace-focus-top">
                    <div>
                      <strong>{item.ticker}</strong>
                      <p className="text-muted">{item.company}</p>
                    </div>
                    <span className={item.move.startsWith("-") ? "trend-chip trend-down" : "trend-chip trend-up"}>{item.move}</span>
                  </div>
                  <p>{item.catalyst}</p>
                  <button className="inline-button" type="button">
                    {item.action}
                  </button>
                </article>
              ))}
            </div>
          </section>

          <section className="workspace-card workspace-watchlist-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Competitor Gap</p>
                <h2>Where FINDEC wins the workflow</h2>
              </div>
              <Link className="button button-secondary workspace-inline-link" href="/query">
                Open live brief
              </Link>
            </div>

            <div className="workspace-grid-three">
              <article className="workspace-mini-card">
                <p className="eyebrow">Execution apps</p>
                <h3>Minimal, but disconnected</h3>
                <p className="text-muted">Trading is clean, but the user still leaves the broker to answer basic research questions.</p>
              </article>
              <article className="workspace-mini-card">
                <p className="eyebrow">Research apps</p>
                <h3>Powerful, but overloaded</h3>
                <p className="text-muted">The data is there, yet newer investors have to interpret too much raw material on their own.</p>
              </article>
              <article className="workspace-mini-card">
                <p className="eyebrow">FINDEC</p>
                <h3>Copilot in context</h3>
                <p className="text-muted">The chart, the thesis, the explanation, and the next action live together in one decision loop.</p>
              </article>
            </div>

            <div className="workspace-watchlist-row">
              {watchlistPreview.length > 0 ? (
                watchlistPreview.map((item) => (
                  <article className="workspace-ticker-card" key={item.symbol}>
                    <span className="metric-label">{item.symbol}</span>
                    <strong>{item.name}</strong>
                    <span className={item.changePercent >= 0 ? "ticker-up" : "ticker-down"}>
                      {formatSignedPercent(item.changePercent)}
                    </span>
                  </article>
                ))
              ) : (
                <article className="workspace-empty-state">
                  <strong>Watchlist preview will appear here.</strong>
                  <p className="text-muted">Once live market data loads, the morning dashboard can map overnight moves directly to your saved names.</p>
                </article>
              )}
            </div>

            {marketSnapshot?.featuredTickers?.length ? (
              <div className="workspace-country-strip">
                {marketSnapshot.featuredTickers.map((item) => (
                  <article className="workspace-country-card" key={item.symbol}>
                    <span className="metric-label">{item.exchange}</span>
                    <strong>{item.name}</strong>
                    <p className="text-muted">{item.reason}</p>
                    <Link className="inline-button" href={`/brief?ticker=${encodeURIComponent(item.symbol)}`}>
                      Open brief
                    </Link>
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        </div>

        <aside className="workspace-sidebar">
          <section className="workspace-copilot-panel">
            <div className="workspace-copilot-header">
              <div>
                <p className="eyebrow">AI Copilot</p>
                <h2>Apple context loaded</h2>
              </div>
              <span className="badge badge-ghost">Context aware</span>
            </div>

            <div className="workspace-command-box">
              <p className="metric-label">Global command palette</p>
              <strong>Cmd + K</strong>
              <p className="text-muted">
                Search tickers, ask a natural-language question, or jump to a saved report from one input surface.
              </p>
            </div>

            <div className="workspace-chip-column">
              {commandShortcuts.map((shortcut) => (
                <button className="quick-chip workspace-command-chip" key={shortcut} type="button">
                  {shortcut}
                </button>
              ))}
            </div>

            <article className="workspace-ai-response">
              <p className="eyebrow">Copilot Answer</p>
              <h3>Why did AAPL hold up better than peers?</h3>
              <p>
                Services strength and balance-sheet quality are acting like a cushion. The AI agents see less narrative damage here than in names where margins are being repriced.
              </p>
              <div className="workspace-thesis-grid">
                <div>
                  <span className="metric-label">Bull case</span>
                  <strong>Sticky cash flows</strong>
                </div>
                <div>
                  <span className="metric-label">Bear case</span>
                  <strong>Growth cools</strong>
                </div>
              </div>
            </article>

            <article className="workspace-agent-panel">
              <div className="workspace-subcard-header">
                <div>
                  <p className="eyebrow">Agent Orchestration</p>
                  <h3>Multi-agent status</h3>
                </div>
                <span className="workspace-mini-label">Live system feel</span>
              </div>
              <div className="workspace-agent-list">
                {agentTimeline.map((item) => (
                  <div className="workspace-agent-row" key={item.agent}>
                    <div>
                      <strong>{item.agent}</strong>
                      <p className="text-muted">{item.note}</p>
                    </div>
                    <span className="badge badge-ghost">{item.status}</span>
                  </div>
                ))}
              </div>
            </article>

            <div className="button-row">
              <Link className="button button-primary" href="/brief">
                Start a live brief
              </Link>
              <Link className="button button-secondary" href="/radar">
                Open radar
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}
