"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getResearch } from "../services/api";
import type { DividendStock, ResearchResponse, SectorSummary } from "../types";

type Tab = "sectors" | "dividends";
type DivSort = "yield" | "change" | "symbol";

// Map an average % change to a heat color (red → neutral → green).
function heatColor(pct: number): string {
  const clamped = Math.max(-3, Math.min(3, pct));
  if (clamped >= 0) {
    const a = 0.12 + (clamped / 3) * 0.55;
    return `rgba(51, 179, 107, ${a.toFixed(2)})`;
  }
  const a = 0.12 + (Math.abs(clamped) / 3) * 0.55;
  return `rgba(204, 81, 71, ${a.toFixed(2)})`;
}

function Signed({ v }: { v: number }) {
  const cls = v > 0 ? "findec-subline-up" : v < 0 ? "findec-subline-down" : "";
  return <span className={cls}>{v >= 0 ? "+" : ""}{v.toFixed(2)}%</span>;
}

export default function Research() {
  const [tab, setTab] = useState<Tab>("sectors");
  const [data, setData] = useState<ResearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [divSort, setDivSort] = useState<DivSort>("yield");

  useEffect(() => {
    getResearch()
      .then((res) => { setData(res); setLoading(false); })
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : "Failed to load research data."); setLoading(false); });
  }, []);

  const sortedDividends = useMemo<DividendStock[]>(() => {
    if (!data) return [];
    const arr = [...data.dividendStocks];
    if (divSort === "yield") arr.sort((a, b) => b.dividendYield - a.dividendYield);
    else if (divSort === "change") arr.sort((a, b) => b.changePercent - a.changePercent);
    else arr.sort((a, b) => a.symbol.localeCompare(b.symbol));
    return arr;
  }, [data, divSort]);

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: "sectors", label: "Sector Heatmap", count: data?.sectors.length ?? 0 },
    { id: "dividends", label: "Dividend Tracker", count: data?.dividendStocks.length ?? 0 },
  ];

  return (
    <section className="findec-minimal-page">
      <div className="findec-minimal-shell earn-shell">
        <div className="earn-header">
          <div>
            <p className="findec-kicker">Research Tools</p>
            <h1 className="earn-title">Sectors &amp; Dividends</h1>
          </div>
          <div className="earn-header-actions">
            <Link href="/earnings" className="earn-nav-btn">Earnings →</Link>
            <Link href="/screener" className="earn-nav-btn">Screener →</Link>
          </div>
        </div>

        <div className="earn-tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`earn-tab ${tab === t.id ? "earn-tab-active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {!loading && t.count > 0 && <span className="earn-tab-count">{t.count}</span>}
            </button>
          ))}
        </div>

        {error && <div className="findec-panel earn-error">{error}</div>}
        {loading && <p className="findec-kicker earn-loading">Loading research…</p>}

        {/* ── Sector Heatmap ── */}
        {!loading && !error && data && tab === "sectors" && (
          <>
            {data.sectors.length === 0 ? (
              <div className="findec-panel"><p className="earn-empty">No sector data available right now.</p></div>
            ) : (
              <div className="rsrch-heatmap">
                {data.sectors.map((s: SectorSummary) => (
                  <article
                    key={s.sector}
                    className="rsrch-sector-cell"
                    style={{ background: heatColor(s.avgChangePercent) }}
                  >
                    <div className="rsrch-sector-head">
                      <span className="rsrch-sector-name">{s.sector}</span>
                      <span className="rsrch-sector-count">{s.count}</span>
                    </div>
                    <strong className="rsrch-sector-pct"><Signed v={s.avgChangePercent} /></strong>
                    <div className="rsrch-sector-foot">
                      {s.topGainer && (
                        <span className="rsrch-mover">
                          <Link href={`/stock/${encodeURIComponent(s.topGainer.symbol)}`}>{s.topGainer.symbol}</Link>
                          <em className="findec-subline-up">{s.topGainer.changePercent >= 0 ? "+" : ""}{s.topGainer.changePercent}%</em>
                        </span>
                      )}
                      {s.topLoser && s.topLoser.symbol !== s.topGainer?.symbol && (
                        <span className="rsrch-mover">
                          <Link href={`/stock/${encodeURIComponent(s.topLoser.symbol)}`}>{s.topLoser.symbol}</Link>
                          <em className="findec-subline-down">{s.topLoser.changePercent}%</em>
                        </span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
            <p className="rsrch-note">Color intensity reflects each sector&apos;s average session move across tracked constituents.</p>
          </>
        )}

        {/* ── Dividend Tracker ── */}
        {!loading && !error && data && tab === "dividends" && (
          <div className="findec-panel earn-table-wrap">
            {sortedDividends.length === 0 ? (
              <p className="earn-empty">No dividend-paying stocks in the current data set.</p>
            ) : (
              <>
                <div className="rsrch-div-sort">
                  <span className="adv-toggle-label">Sort</span>
                  <button className={`adv-chip ${divSort === "yield" ? "adv-chip-on" : ""}`} onClick={() => setDivSort("yield")}>Yield</button>
                  <button className={`adv-chip ${divSort === "change" ? "adv-chip-on" : ""}`} onClick={() => setDivSort("change")}>Today</button>
                  <button className={`adv-chip ${divSort === "symbol" ? "adv-chip-on" : ""}`} onClick={() => setDivSort("symbol")}>Symbol</button>
                </div>
                <table className="earn-table">
                  <thead>
                    <tr>
                      <th className="earn-th">Company</th>
                      <th className="earn-th earn-th-r">Price</th>
                      <th className="earn-th earn-th-r">Today</th>
                      <th className="earn-th earn-th-r">Div Yield</th>
                      <th className="earn-th earn-th-r earn-hide-sm">P/E</th>
                      <th className="earn-th"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedDividends.map((d) => (
                      <tr key={d.symbol} className="earn-row">
                        <td className="earn-td">
                          <Link href={`/stock/${encodeURIComponent(d.symbol)}`} className="earn-symbol">{d.symbol}</Link>
                          <span className="earn-company">{d.name}</span>
                        </td>
                        <td className="earn-td earn-td-r">{d.price.toFixed(2)}</td>
                        <td className="earn-td earn-td-r"><Signed v={d.changePercent} /></td>
                        <td className="earn-td earn-td-r">
                          <strong className={d.dividendYield >= 3 ? "findec-subline-up" : ""}>{d.dividendYield.toFixed(2)}%</strong>
                        </td>
                        <td className="earn-td earn-td-r earn-hide-sm">{d.peRatio != null ? d.peRatio : <span className="earn-dim">—</span>}</td>
                        <td className="earn-td earn-td-actions">
                          <Link href={`/brief?ticker=${encodeURIComponent(d.symbol)}`} className="earn-action">Brief</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="rsrch-note">Yields ≥ 3% are highlighted as income-grade. Sourced from live fundamentals.</p>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
