"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  getMarketSnapshot, getStocks, getMarketRegime, getSessionUser,
  type MarketRegime,
} from "../services/api";
import type { MarketSnapshot, StockQuote, StocksResponse } from "../types";

function fmtPct(v: number) { return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`; }
function pctClass(v: number) { return v > 0 ? "findec-subline-up" : v < 0 ? "findec-subline-down" : ""; }

const TILES = [
  { href: "/markets", label: "Markets", desc: "Live quotes & indices" },
  { href: "/screener", label: "Screener", desc: "Filter by fundamentals" },
  { href: "/research", label: "Research", desc: "Sectors & dividends" },
  { href: "/insights", label: "Insights", desc: "Regime & portfolio" },
  { href: "/watchlist", label: "Watchlist", desc: "Track your names" },
  { href: "/paper", label: "Paper Trading", desc: "Practice risk-free" },
  { href: "/calendar", label: "Calendar", desc: "Earnings & ledger" },
  { href: "/earnings", label: "Earnings", desc: "Upcoming & IPOs" },
];

export default function HomeDashboard() {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [stocks, setStocks] = useState<StocksResponse | null>(null);
  const [regime, setRegime] = useState<MarketRegime | null>(null);
  const [user, setUser] = useState<string | null>(null);

  useEffect(() => {
    setUser(getSessionUser()?.email?.split("@")[0] ?? null);
    void getMarketSnapshot().then(setSnapshot).catch(() => setSnapshot(null));
    void getStocks().then(setStocks).catch(() => setStocks(null));
    void getMarketRegime().then(setRegime).catch(() => setRegime(null));
  }, []);

  const indices = stocks?.indices ?? [];
  const movers = useMemo(() => {
    const s = [...(stocks?.stocks ?? [])];
    const gainers = [...s].sort((a, b) => b.changePercent - a.changePercent).slice(0, 5);
    const losers = [...s].sort((a, b) => a.changePercent - b.changePercent).slice(0, 5);
    return { gainers, losers };
  }, [stocks]);

  const regimeCls = regime?.regime === "risk-on" ? "ins-regime-on" : regime?.regime === "risk-off" ? "ins-regime-off" : "ins-regime-neutral";

  return (
    <section className="findec-minimal-page">
      <div className="findec-minimal-shell home-shell">
        {/* Hero */}
        <section className="findec-panel home-hero">
          <div className="home-hero-text">
            <p className="findec-kicker">{user ? `Welcome back, ${user}` : "Welcome to Findec"}</p>
            <h1 className="home-hero-title">Your market, decoded.</h1>
            <p className="home-hero-sub">Live data, AI briefs, screening, paper trading and research — in one workspace.</p>
            <div className="home-hero-cta">
              <Link href="/brief" className="home-cta-primary">▶ Run an AI Brief</Link>
              <Link href="/markets" className="home-cta-ghost">Explore Markets →</Link>
            </div>
          </div>
          {snapshot && (
            <div className="home-hero-status">
              <span className={`findec-market-dot findec-market-dot-${snapshot.market.phase}`} />
              <div>
                <strong>{snapshot.market.label}</strong>
                <span className="home-hero-status-sub">{snapshot.geoLocation.country} · {snapshot.market.sessionHours}</span>
              </div>
            </div>
          )}
        </section>

        {/* Indices + regime */}
        <div className="home-row">
          {indices.length > 0 && (
            <div className="home-indices">
              {indices.slice(0, 4).map((idx) => (
                <article key={idx.symbol} className="findec-panel home-index">
                  <p className="findec-kicker">{idx.symbol.replace("^", "")}</p>
                  <strong>{idx.lastClose.toLocaleString()}</strong>
                  <span className={pctClass(idx.changePercent)}>{fmtPct(idx.changePercent)}</span>
                </article>
              ))}
            </div>
          )}
          {regime && (
            <Link href="/insights" className="findec-panel home-regime">
              <p className="findec-kicker">Market Regime</p>
              <span className={`ins-regime-badge ${regimeCls}`}>{regime.regime.toUpperCase()}</span>
              <span className="home-regime-sub">{regime.advancing}/{regime.total} up · {fmtPct(regime.avgMovePercent)} avg</span>
            </Link>
          )}
        </div>

        {/* Movers */}
        {(movers.gainers.length > 0) && (
          <div className="home-movers">
            <MoverCard title="Top Gainers" rows={movers.gainers} />
            <MoverCard title="Top Losers" rows={movers.losers} />
          </div>
        )}

        {/* Quick access */}
        <section className="home-tiles">
          {TILES.map((t) => (
            <Link key={t.href} href={t.href} className="findec-panel home-tile">
              <strong>{t.label}</strong>
              <span>{t.desc}</span>
            </Link>
          ))}
        </section>
      </div>
    </section>
  );
}

function MoverCard({ title, rows }: { title: string; rows: StockQuote[] }) {
  return (
    <article className="findec-panel home-mover-card">
      <p className="findec-kicker">{title}</p>
      <div className="home-mover-list">
        {rows.map((s) => (
          <Link key={s.symbol} href={`/stock/${encodeURIComponent(s.symbol)}`} className="home-mover-row">
            <span className="home-mover-sym">{s.symbol}</span>
            <span className="home-mover-name">{s.name}</span>
            <span className={pctClass(s.changePercent)}>{fmtPct(s.changePercent)}</span>
          </Link>
        ))}
      </div>
    </article>
  );
}
