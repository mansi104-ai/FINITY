"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getMarketSnapshot, getStocks } from "../services/api";
import type { MarketSnapshot, StockQuote, StocksResponse } from "../types";

function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function fmtCap(v: number): string {
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  return v.toLocaleString();
}

function fmtVol(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}

function fmtPrice(v: number, currency: string): string {
  if (currency === "GBp") return `${(v / 100).toFixed(2)} GBP`;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: v >= 100 ? 1 : 2,
    minimumFractionDigits: 2
  }).format(v);
}

function positionIn52w(price: number, low: number, high: number): number {
  if (high <= low) return 50;
  return Math.min(100, Math.max(0, ((price - low) / (high - low)) * 100));
}

function RangeMeter({ price, low, high }: { price: number; low: number; high: number }) {
  const pct = positionIn52w(price, low, high);
  return (
    <div className="mkt-range-wrap">
      <div className="mkt-range-track">
        <div className="mkt-range-dot" style={{ left: `${pct}%` }} />
      </div>
      <div className="mkt-range-labels">
        <span>{low.toLocaleString()}</span>
        <span>{high.toLocaleString()}</span>
      </div>
    </div>
  );
}

function ChangeChip({ value }: { value: number }) {
  const cls = value > 0 ? "findec-subline-up" : value < 0 ? "findec-subline-down" : "";
  return <span className={`mkt-change-chip ${cls}`}>{fmtPct(value)}</span>;
}

type SortKey = "changePercent" | "peRatio" | "marketCap" | "name";

export default function Markets() {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [stocksData, setStocksData] = useState<StocksResponse | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("marketCap");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [tab, setTab] = useState<"all" | "gainers" | "losers">("all");

  useEffect(() => {
    const load = async () => {
      try {
        const [snap, stocks] = await Promise.all([getMarketSnapshot(), getStocks()]);
        setSnapshot(snap);
        setStocksData(stocks);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load market data.");
      }
    };
    void load();
  }, []);

  const allStocks: StockQuote[] = stocksData?.stocks ?? [];

  const sorted = useMemo(() => {
    let list = [...allStocks];
    if (tab === "gainers") list = list.filter((s) => s.changePercent > 0);
    if (tab === "losers") list = list.filter((s) => s.changePercent < 0);
    if (search.trim()) {
      const q = search.trim().toUpperCase();
      list = list.filter((s) => s.symbol.toUpperCase().includes(q) || s.name.toUpperCase().includes(q));
    }
    list.sort((a, b) => {
      let av = 0, bv = 0;
      if (sortBy === "changePercent") { av = a.changePercent; bv = b.changePercent; }
      else if (sortBy === "peRatio") { av = a.peRatio ?? 0; bv = b.peRatio ?? 0; }
      else if (sortBy === "marketCap") { av = a.marketCap ?? 0; bv = b.marketCap ?? 0; }
      else if (sortBy === "name") { return sortDir === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name); }
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return list;
  }, [allStocks, search, sortBy, sortDir, tab]);

  const topGainers = useMemo(
    () => [...allStocks].sort((a, b) => b.changePercent - a.changePercent).slice(0, 4),
    [allStocks]
  );
  const topLosers = useMemo(
    () => [...allStocks].sort((a, b) => a.changePercent - b.changePercent).slice(0, 4),
    [allStocks]
  );

  function toggleSort(key: SortKey) {
    if (sortBy === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortBy(key); setSortDir("desc"); }
  }

  const indices = stocksData?.indices ?? [];

  return (
    <section className="findec-minimal-page">
      <div className="findec-minimal-shell">

        {/* ── Header ── */}
        <div className="mkt-page-header">
          <div>
            <p className="findec-kicker">Live Market Data</p>
            <h1 className="mkt-page-title">
              {snapshot ? snapshot.geoLocation.country : "Global"} Markets
            </h1>
          </div>
          {snapshot && (
            <div className="mkt-status-pill">
              <span className={`findec-market-dot findec-market-dot-${snapshot.market.phase}`} />
              <span>{snapshot.market.label}</span>
              <span className="mkt-status-hours">{snapshot.market.sessionHours}</span>
            </div>
          )}
        </div>

        {error && (
          <div className="findec-panel finity-error-panel" style={{ marginTop: "1rem", padding: "0.9rem 1rem" }}>
            {error}
          </div>
        )}

        {/* ── Indices ── */}
        {indices.length > 0 && (
          <div className="mkt-indices-grid" style={{ marginTop: "1.2rem" }}>
            {indices.map((idx) => (
              <article key={idx.symbol} className="findec-panel findec-metric-panel mkt-index-card">
                <p className="findec-kicker">{idx.symbol.replace("^", "")}</p>
                <strong>{fmtPrice(idx.lastClose, idx.currency)}</strong>
                <ChangeChip value={idx.changePercent} />
              </article>
            ))}
          </div>
        )}

        {/* ── Movers strip ── */}
        {(topGainers.length > 0 || topLosers.length > 0) && (
          <div className="mkt-movers-grid" style={{ marginTop: "1.1rem" }}>
            <article className="findec-panel mkt-movers-panel">
              <p className="findec-kicker" style={{ marginBottom: "0.6rem" }}>Top Gainers</p>
              <div className="mkt-mover-list">
                {topGainers.map((s) => (
                  <Link key={s.symbol} href={`/brief?ticker=${encodeURIComponent(s.symbol)}`} className="mkt-mover-row">
                    <span className="mkt-mover-sym">{s.symbol}</span>
                    <span className="mkt-mover-name">{s.name}</span>
                    <ChangeChip value={s.changePercent} />
                  </Link>
                ))}
              </div>
            </article>
            <article className="findec-panel mkt-movers-panel">
              <p className="findec-kicker" style={{ marginBottom: "0.6rem" }}>Top Losers</p>
              <div className="mkt-mover-list">
                {topLosers.map((s) => (
                  <Link key={s.symbol} href={`/brief?ticker=${encodeURIComponent(s.symbol)}`} className="mkt-mover-row">
                    <span className="mkt-mover-sym">{s.symbol}</span>
                    <span className="mkt-mover-name">{s.name}</span>
                    <ChangeChip value={s.changePercent} />
                  </Link>
                ))}
              </div>
            </article>
          </div>
        )}

        {/* ── Stocks table ── */}
        <article className="findec-panel" style={{ marginTop: "1.1rem", padding: "1rem" }}>
          <div className="mkt-table-controls">
            <div className="mkt-tab-row">
              {(["all", "gainers", "losers"] as const).map((t) => (
                <button
                  key={t}
                  className={`mkt-tab ${tab === t ? "mkt-tab-active" : ""}`}
                  onClick={() => setTab(t)}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            <input
              className="findec-search-input mkt-search"
              placeholder="search symbol or name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {sorted.length === 0 ? (
            <p className="findec-kicker" style={{ marginTop: "1.5rem", textAlign: "center" }}>
              {stocksData ? "No stocks match." : "Loading stocks..."}
            </p>
          ) : (
            <div className="mkt-table-wrap">
              <table className="mkt-table">
                <thead>
                  <tr>
                    <th className="mkt-th mkt-th-sym">Symbol</th>
                    <th className="mkt-th mkt-th-name">
                      <button className="mkt-sort-btn" onClick={() => toggleSort("name")}>
                        Name {sortBy === "name" ? (sortDir === "desc" ? "↓" : "↑") : ""}
                      </button>
                    </th>
                    <th className="mkt-th mkt-th-price">Price</th>
                    <th className="mkt-th">
                      <button className="mkt-sort-btn" onClick={() => toggleSort("changePercent")}>
                        Chg% {sortBy === "changePercent" ? (sortDir === "desc" ? "↓" : "↑") : ""}
                      </button>
                    </th>
                    <th className="mkt-th mkt-th-hide-sm">
                      <button className="mkt-sort-btn" onClick={() => toggleSort("marketCap")}>
                        Mkt Cap {sortBy === "marketCap" ? (sortDir === "desc" ? "↓" : "↑") : ""}
                      </button>
                    </th>
                    <th className="mkt-th mkt-th-hide-sm">
                      <button className="mkt-sort-btn" onClick={() => toggleSort("peRatio")}>
                        P/E {sortBy === "peRatio" ? (sortDir === "desc" ? "↓" : "↑") : ""}
                      </button>
                    </th>
                    <th className="mkt-th mkt-th-hide-md">Fwd P/E</th>
                    <th className="mkt-th mkt-th-hide-md">Div Yield</th>
                    <th className="mkt-th mkt-th-hide-md">Beta</th>
                    <th className="mkt-th mkt-th-hide-sm">52W Range</th>
                    <th className="mkt-th mkt-th-action">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((s) => (
                    <tr key={s.symbol} className="mkt-tr">
                      <td className="mkt-td mkt-td-sym">
                        <strong>{s.symbol}</strong>
                      </td>
                      <td className="mkt-td mkt-td-name">
                        <span>{s.name}</span>
                        {s.exchange ? <span className="mkt-exchange-tag">{s.exchange}</span> : null}
                      </td>
                      <td className="mkt-td mkt-td-price">
                        <span className="mkt-price-val">{fmtPrice(s.price, s.currency)}</span>
                        <span className="mkt-currency-tag">{s.currency}</span>
                      </td>
                      <td className="mkt-td">
                        <ChangeChip value={s.changePercent} />
                      </td>
                      <td className="mkt-td mkt-th-hide-sm">
                        {s.marketCap != null ? fmtCap(s.marketCap) : <span className="mkt-na">—</span>}
                      </td>
                      <td className="mkt-td mkt-th-hide-sm">
                        {s.peRatio != null ? s.peRatio : <span className="mkt-na">—</span>}
                      </td>
                      <td className="mkt-td mkt-th-hide-md">
                        {s.forwardPE != null ? s.forwardPE : <span className="mkt-na">—</span>}
                      </td>
                      <td className="mkt-td mkt-th-hide-md">
                        {s.dividendYield != null ? `${s.dividendYield.toFixed(2)}%` : <span className="mkt-na">—</span>}
                      </td>
                      <td className="mkt-td mkt-th-hide-md">
                        {s.beta != null ? s.beta : <span className="mkt-na">—</span>}
                      </td>
                      <td className="mkt-td mkt-th-hide-sm">
                        {s.high52w != null && s.low52w != null ? (
                          <RangeMeter price={s.price} low={s.low52w} high={s.high52w} />
                        ) : (
                          <span className="mkt-na">—</span>
                        )}
                      </td>
                      <td className="mkt-td mkt-td-action">
                        <Link className="mkt-brief-btn" href={`/brief?ticker=${encodeURIComponent(s.symbol)}`}>
                          Brief
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        {/* ── Featured / suggestions ── */}
        {snapshot && snapshot.featuredTickers.length > 0 && (
          <article className="findec-panel" style={{ marginTop: "1rem", padding: "1rem" }}>
            <p className="findec-kicker" style={{ marginBottom: "0.7rem" }}>Ideas to Start From</p>
            <div className="mkt-featured-grid">
              {snapshot.featuredTickers.map((f) => (
                <article key={f.symbol} className="mkt-featured-card">
                  <div className="mkt-featured-top">
                    <div>
                      <strong>{f.symbol}</strong>
                      <p style={{ margin: "0.15rem 0 0", color: "#696d72", fontSize: "0.82rem" }}>{f.name}</p>
                    </div>
                    <span className="mkt-exchange-tag">{f.exchange}</span>
                  </div>
                  <p style={{ margin: "0.55rem 0 0.7rem", color: "#555960", fontSize: "0.81rem", lineHeight: 1.5 }}>{f.reason}</p>
                  <Link className="mkt-brief-btn" href={`/brief?ticker=${encodeURIComponent(f.symbol)}`}>
                    Build Brief →
                  </Link>
                </article>
              ))}
            </div>
          </article>
        )}

        {/* ── Volume leaders ── */}
        {allStocks.filter((s) => s.volume != null).length > 0 && (
          <article className="findec-panel" style={{ marginTop: "1rem", padding: "1rem" }}>
            <p className="findec-kicker" style={{ marginBottom: "0.7rem" }}>Volume Leaders Today</p>
            <div className="mkt-vol-grid">
              {[...allStocks]
                .filter((s) => s.volume != null)
                .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
                .slice(0, 6)
                .map((s) => (
                  <Link key={s.symbol} href={`/brief?ticker=${encodeURIComponent(s.symbol)}`} className="mkt-vol-card">
                    <span className="mkt-mover-sym">{s.symbol}</span>
                    <strong style={{ display: "block", marginTop: "0.3rem", color: "#f4efe6" }}>
                      {fmtVol(s.volume!)}
                    </strong>
                    <span style={{ color: "#696d72", fontSize: "0.75rem" }}>
                      avg {s.avgVolume != null ? fmtVol(s.avgVolume) : "—"}
                    </span>
                    <ChangeChip value={s.changePercent} />
                  </Link>
                ))}
            </div>
          </article>
        )}

        <p className="findec-kicker" style={{ marginTop: "1.2rem", textAlign: "center" }}>
          Data via Yahoo Finance · refreshed on page load ·{" "}
          {stocksData ? new Date(stocksData.asOf).toLocaleTimeString() : "—"}
        </p>
      </div>
    </section>
  );
}
