"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MetricInfoPopover } from "../components/MetricInfoPopover";
import { getMarketSnapshot } from "../services/api";
import type { MarketSnapshot } from "../types";

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
  const [homeQuery, setHomeQuery] = useState("");
  const router = useRouter();

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

  const radarCompanies = useMemo(() => {
    return (marketSnapshot?.featuredTickers ?? []).slice(0, 5).map((company) => ({
      ...company,
      quote: marketSnapshot?.tickers.find((ticker) => ticker.symbol.toUpperCase() === company.symbol.toUpperCase()) ?? null
    }));
  }, [marketSnapshot]);

  const submitHomeQuery = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedQuery = homeQuery.trim();
    if (!trimmedQuery) {
      return;
    }

    router.push(`/brief?query=${encodeURIComponent(trimmedQuery)}`);
  };

  return (
    <section className="workspace-shell">
      <div className="workspace-dashboard-layout">
        <div className="workspace-main">
          <section className="workspace-card workspace-morning-board">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Ask FINDEC</p>
                <h2>Build a brief</h2>
              </div>
              <p className="text-muted">
                {marketSnapshot ? `Synced ${formatMarketClock(marketSnapshot.asOf)} | ${marketSnapshot.market.label}` : "Waiting for live market snapshot"}
              </p>
            </div>

            <form className="workspace-query-form" onSubmit={submitHomeQuery}>
              <label className="label" htmlFor="home-query">
                Your query
              </label>
              <div className="workspace-query-row">
                <input
                  className="input"
                  id="home-query"
                  onChange={(event) => setHomeQuery(event.target.value)}
                  placeholder="Ask about a local company, ticker, or the market today"
                  value={homeQuery}
                />
                <button className="button button-primary workspace-query-button" disabled={!homeQuery.trim()} type="submit">
                  Build Brief
                </button>
              </div>
            </form>

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
          </section>
        </div>

        <aside className="workspace-card workspace-radar-box" aria-label="Geolocation radar companies">
          <div className="workspace-radar-header">
            <div>
              <p className="eyebrow">Radar</p>
              <h2>Names to watch now</h2>
            </div>
            {marketSnapshot?.geoLocation.countryCode && (
              <span className="badge badge-ghost">{marketSnapshot.geoLocation.countryCode}</span>
            )}
          </div>

          <div className="workspace-radar-list">
            {radarCompanies.length > 0 ? (
              radarCompanies.map((item) => (
                <button
                  className="workspace-radar-company"
                  key={item.symbol}
                  onClick={() => router.push(`/brief?ticker=${encodeURIComponent(item.symbol)}`)}
                  type="button"
                >
                  <span>
                    <strong>{item.symbol}</strong>
                    <small>{item.name}</small>
                  </span>
                  {item.quote ? (
                    <span className={item.quote.changePercent >= 0 ? "ticker-up" : "ticker-down"}>
                      {formatSignedPercent(item.quote.changePercent)}
                    </span>
                  ) : (
                    <span className="metric-label">{item.exchange}</span>
                  )}
                </button>
              ))
            ) : (
              <div className="workspace-empty-state workspace-radar-empty">
                <strong>Loading local companies</strong>
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
