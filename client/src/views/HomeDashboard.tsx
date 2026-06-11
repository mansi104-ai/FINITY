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

const FEATURES = [
  { icon: "bolt", title: "AI Brief", desc: "A researcher, analyst & risk-manager verdict on any stock — in plain English.", badge: "Unique" },
  { icon: "gauge", title: "Findec Scorecard", desc: "A 0–100 read on valuation, momentum, stability & income for every stock.", badge: "" },
  { icon: "target", title: "AI Track Record", desc: "We grade our own past calls against what the stock actually did. No one else does.", badge: "Unique" },
  { icon: "bell", title: "Smart Alerts", desc: "Price alerts that actually fire — once, or a daily reminder while it holds.", badge: "" },
  { icon: "flask", title: "Paper Trading", desc: "Practice the trade with virtual money before you risk real capital.", badge: "" },
  { icon: "globe", title: "India + Global", desc: "Live NSE, US, UK, Japan & China data, fundamentals and news — one app.", badge: "" },
];

const WHY = [
  { k: "AI that takes a stance", v: "Competitors hand you raw data. Findec gives a clear verdict and shows its track record." },
  { k: "Free where others charge", v: "Scorecards, AI briefs, screening and paper trading — free. Pro only lifts limits." },
  { k: "Built for India", v: "NSE-first with accurate fundamentals, sectors and dividends, plus global coverage." },
];

function FIcon({ k }: { k: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (k) {
    case "bolt": return <svg width="22" height="22" viewBox="0 0 24 24" {...p}><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>;
    case "gauge": return <svg width="22" height="22" viewBox="0 0 24 24" {...p}><path d="M12 14l4-4M5 18a9 9 0 1 1 14 0" /><circle cx="12" cy="14" r="1.4" fill="currentColor" stroke="none" /></svg>;
    case "target": return <svg width="22" height="22" viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.4" /></svg>;
    case "bell": return <svg width="22" height="22" viewBox="0 0 24 24" {...p}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" /></svg>;
    case "flask": return <svg width="22" height="22" viewBox="0 0 24 24" {...p}><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" /></svg>;
    case "globe": return <svg width="22" height="22" viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>;
    default: return null;
  }
}

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
        {/* ── Bold branded hero ── */}
        <section className="home-hero2">
          <div className="home-hero2-glow" aria-hidden="true" />
          <div className="home-hero2-inner">
            <span className="home-badge">AI-powered · India + Global markets</span>
            <h1 className="home-hero2-title">
              Stop guessing.<br /><span className="home-grad-text">Get an AI verdict.</span>
            </h1>
            <p className="home-hero2-sub">
              {user ? `Welcome back, ${user}. ` : ""}Findec reads the data, scores the stock, and tells you what it
              means — then grades its own calls so you know it&apos;s honest.
            </p>
            <div className="home-hero2-cta">
              <Link href="/brief" className="home-btn-brand">⚡ Run a free AI Brief</Link>
              <Link href="/markets" className="home-btn-ghost">Explore markets →</Link>
            </div>
            <p className="home-hero2-trust">
              {snapshot ? (
                <><span className={`findec-market-dot findec-market-dot-${snapshot.market.phase}`} /> {snapshot.market.label} · {snapshot.geoLocation.country}</>
              ) : "Live market data"}
              <span className="home-trust-sep">·</span> Decision support, not advice
            </p>
          </div>
        </section>

        {/* ── Feature highlights ── */}
        <section className="home-features">
          {FEATURES.map((f) => (
            <article key={f.title} className="home-feature">
              <span className="home-feature-ico"><FIcon k={f.icon} /></span>
              <div className="home-feature-body">
                <div className="home-feature-head">
                  <strong>{f.title}</strong>
                  {f.badge && <span className="home-feature-badge">{f.badge}</span>}
                </div>
                <span className="home-feature-desc">{f.desc}</span>
              </div>
            </article>
          ))}
        </section>

        {/* ── Live market ── */}
        <div className="home-section-label">Live market</div>
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

        {(movers.gainers.length > 0) && (
          <div className="home-movers">
            <MoverCard title="Top Gainers" rows={movers.gainers} />
            <MoverCard title="Top Losers" rows={movers.losers} />
          </div>
        )}

        {/* ── Why Findec ── */}
        <section className="home-why">
          <h2 className="home-why-title">Why investors pick <span className="home-grad-text">Findec</span></h2>
          <div className="home-why-grid">
            {WHY.map((w) => (
              <div key={w.k} className="home-why-card">
                <strong>{w.k}</strong>
                <span>{w.v}</span>
              </div>
            ))}
          </div>
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
