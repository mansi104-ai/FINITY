"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getMarketSnapshot } from "../services/api";
import type { MarketSnapshot } from "../types";

function formatSignedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export default function Radar() {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        setSnapshot(await getMarketSnapshot());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load radar right now.");
      }
    };

    void load();
  }, []);

  return (
    <section className="grid page-shell">
      <article className="hero-panel">
        <div>
          <p className="eyebrow">Radar</p>
          <h1 className="hero-title">Country-aware stock radar for your market context.</h1>
          <p className="hero-copy">
            FINDEC detects the user&apos;s IP-derived country, maps it to the local market, and suggests companies that are actually relevant to that geography.
          </p>
        </div>
        <div className="hero-strip">
          <div className="metric-card">
            <span className="metric-label">Detected country</span>
            <strong>{snapshot?.geoLocation.country ?? "Loading"}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Market</span>
            <strong>{snapshot?.market.market ?? "..."}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Suggested names</span>
            <strong>{snapshot?.featuredTickers.length ?? 0}</strong>
          </div>
        </div>
      </article>

      {error && (
        <article className="card danger-card">
          <p style={{ margin: 0 }}>{error}</p>
        </article>
      )}

      <article className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Local Market Suggestions</p>
            <h2>
              {snapshot ? `${snapshot.geoLocation.country} ideas to start from` : "Suggested companies"}
            </h2>
          </div>
          <Link className="button button-secondary" href="/brief">
            Open brief console
          </Link>
        </div>

        <div className="workspace-focus-grid">
          {(snapshot?.featuredTickers ?? []).map((item) => (
            <article key={item.symbol} className="workspace-focus-card">
              <div className="workspace-focus-top">
                <div>
                  <strong>{item.symbol}</strong>
                  <p className="text-muted">{item.name}</p>
                </div>
                <span className="badge badge-ghost">{item.exchange}</span>
              </div>
              <p className="text-muted">{item.reason}</p>
              <div className="mini-button-row">
                <Link className="inline-button" href={`/brief?ticker=${encodeURIComponent(item.symbol)}`}>
                  Build Brief
                </Link>
              </div>
            </article>
          ))}
        </div>
      </article>

      <article className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Market Tape</p>
            <h3>Latest tracked movers</h3>
          </div>
        </div>
        <div className="grid grid-2">
          {(snapshot?.tickers ?? []).map((item) => (
            <article key={item.symbol} className="mini-panel">
              <p style={{ marginTop: 0 }}>
                <strong>{item.symbol}</strong>
              </p>
              <p className="text-muted">{item.name}</p>
              <p className={item.changePercent >= 0 ? "ticker-up" : "ticker-down"}>
                {formatSignedPercent(item.changePercent)}
              </p>
            </article>
          ))}
        </div>
      </article>
    </section>
  );
}
