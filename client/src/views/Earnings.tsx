"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getEarnings, getIpoCalendar } from "../services/api";
import type { EarningsEvent, IpoEvent } from "../types";

type Tab = "upcoming" | "recent" | "ipo";

function epsSurprise(est: number | null, act: number | null): { label: string; cls: string } | null {
  if (est == null || act == null) return null;
  const base = Math.abs(est) || 1;
  const diff = ((act - est) / base) * 100;
  if (diff >= 3) return { label: `Beat +${diff.toFixed(1)}%`, cls: "findec-subline-up" };
  if (diff <= -3) return { label: `Miss ${diff.toFixed(1)}%`, cls: "findec-subline-down" };
  return { label: "In line", cls: "" };
}

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric"
  });
}

function fmtRev(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toLocaleString()}`;
}

function hourLabel(h: string): { text: string; cls: string } {
  if (h === "bmo") return { text: "BMO", cls: "earn-bmo" };
  if (h === "amc") return { text: "AMC", cls: "earn-amc" };
  return { text: "MH", cls: "earn-mh" };
}

function fmtIpoVal(v: number): string {
  if (!v) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toLocaleString()}`;
}

export default function Earnings() {
  const [tab, setTab] = useState<Tab>("upcoming");
  const [upcoming, setUpcoming] = useState<EarningsEvent[]>([]);
  const [recent, setRecent] = useState<EarningsEvent[]>([]);
  const [ipos, setIpos] = useState<IpoEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const [earningsRes, ipoRes] = await Promise.all([
          getEarnings(),
          getIpoCalendar(),
        ]);
        setUpcoming(earningsRes.upcoming);
        setRecent(earningsRes.recent);
        setIpos(ipoRes.ipos);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load calendar data.");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: "upcoming", label: "Upcoming", count: upcoming.length },
    { id: "recent", label: "Past Week", count: recent.length },
    { id: "ipo", label: "IPO Pipeline", count: ipos.length },
  ];

  return (
    <section className="findec-minimal-page">
      <div className="findec-minimal-shell earn-shell">
        <div className="earn-header">
          <div>
            <p className="findec-kicker">Market Calendar</p>
            <h1 className="earn-title">Earnings &amp; IPOs</h1>
          </div>
          <div className="earn-header-actions">
            <Link href="/screener" className="earn-nav-btn">Screener →</Link>
            <Link href="/markets" className="earn-nav-btn">Markets →</Link>
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
              {!loading && t.count > 0 && (
                <span className="earn-tab-count">{t.count}</span>
              )}
            </button>
          ))}
        </div>

        {error && <div className="findec-panel earn-error">{error}</div>}
        {loading && <p className="findec-kicker earn-loading">Loading calendar…</p>}

        {/* ── Upcoming Earnings ── */}
        {!loading && !error && tab === "upcoming" && (
          <div className="findec-panel earn-table-wrap">
            {upcoming.length === 0 ? (
              <p className="earn-empty">No upcoming earnings in the next 30 days.</p>
            ) : (
              <table className="earn-table">
                <thead>
                  <tr>
                    <th className="earn-th">Date</th>
                    <th className="earn-th">Company</th>
                    <th className="earn-th earn-th-c">Quarter</th>
                    <th className="earn-th earn-th-c">Time</th>
                    <th className="earn-th earn-th-r">EPS Est.</th>
                    <th className="earn-th earn-th-r earn-hide-sm">Rev Est.</th>
                    <th className="earn-th"></th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map((e, i) => {
                    const { text, cls } = hourLabel(e.hour);
                    return (
                      <tr key={i} className="earn-row">
                        <td className="earn-td earn-td-date">{fmtDate(e.date)}</td>
                        <td className="earn-td">
                          <Link href={`/stock/${encodeURIComponent(e.symbol)}`} className="earn-symbol">{e.symbol}</Link>
                          <span className="earn-company">{e.company}</span>
                        </td>
                        <td className="earn-td earn-td-c">Q{e.quarter} &apos;{String(e.year).slice(2)}</td>
                        <td className="earn-td earn-td-c">
                          <span className={`earn-hour-badge ${cls}`}>{text}</span>
                        </td>
                        <td className="earn-td earn-td-r">
                          {e.epsEstimate != null
                            ? <span>${e.epsEstimate.toFixed(2)}</span>
                            : <span className="earn-dim">—</span>}
                        </td>
                        <td className="earn-td earn-td-r earn-hide-sm">{fmtRev(e.revenueEstimate)}</td>
                        <td className="earn-td earn-td-actions">
                          <Link href={`/brief?ticker=${encodeURIComponent(e.symbol)}`} className="earn-action">Brief</Link>
                          <Link href={`/compare?tickers=${encodeURIComponent(e.symbol)}`} className="earn-action">Compare</Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── Recent Earnings ── */}
        {!loading && !error && tab === "recent" && (
          <div className="findec-panel earn-table-wrap">
            {recent.length === 0 ? (
              <p className="earn-empty">No recent earnings with reported results.</p>
            ) : (
              <table className="earn-table">
                <thead>
                  <tr>
                    <th className="earn-th">Date</th>
                    <th className="earn-th">Company</th>
                    <th className="earn-th earn-th-r">EPS Est.</th>
                    <th className="earn-th earn-th-r">EPS Actual</th>
                    <th className="earn-th earn-th-r earn-hide-sm">Rev Est.</th>
                    <th className="earn-th earn-th-r earn-hide-sm">Rev Actual</th>
                    <th className="earn-th earn-th-c">Surprise</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((e, i) => {
                    const surprise = epsSurprise(e.epsEstimate, e.epsActual);
                    return (
                      <tr key={i} className="earn-row">
                        <td className="earn-td earn-td-date">{fmtDate(e.date)}</td>
                        <td className="earn-td">
                          <Link href={`/stock/${encodeURIComponent(e.symbol)}`} className="earn-symbol">{e.symbol}</Link>
                          <span className="earn-company">{e.company}</span>
                        </td>
                        <td className="earn-td earn-td-r">
                          {e.epsEstimate != null ? `$${e.epsEstimate.toFixed(2)}` : <span className="earn-dim">—</span>}
                        </td>
                        <td className="earn-td earn-td-r">
                          {e.epsActual != null ? `$${e.epsActual.toFixed(2)}` : <span className="earn-dim">—</span>}
                        </td>
                        <td className="earn-td earn-td-r earn-hide-sm">{fmtRev(e.revenueEstimate)}</td>
                        <td className="earn-td earn-td-r earn-hide-sm">{fmtRev(e.revenueActual)}</td>
                        <td className="earn-td earn-td-c">
                          {surprise
                            ? <span className={surprise.cls}>{surprise.label}</span>
                            : <span className="earn-dim">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── IPO Calendar ── */}
        {!loading && !error && tab === "ipo" && (
          <div className="findec-panel earn-table-wrap">
            {ipos.length === 0 ? (
              <p className="earn-empty">No upcoming IPOs in the next 60 days.</p>
            ) : (
              <table className="earn-table">
                <thead>
                  <tr>
                    <th className="earn-th">Date</th>
                    <th className="earn-th">Company</th>
                    <th className="earn-th earn-th-c">Symbol</th>
                    <th className="earn-th earn-th-c earn-hide-sm">Exchange</th>
                    <th className="earn-th earn-th-r">Price Range</th>
                    <th className="earn-th earn-th-r earn-hide-sm">Total Value</th>
                    <th className="earn-th earn-th-c">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {ipos.map((ipo, i) => {
                    const statusCls = ipo.status === "priced"
                      ? "earn-status-priced"
                      : ipo.status === "filed"
                        ? "earn-status-filed"
                        : "earn-status-expected";
                    return (
                      <tr key={i} className="earn-row">
                        <td className="earn-td earn-td-date">{fmtDate(ipo.date)}</td>
                        <td className="earn-td">
                          <span className="earn-company earn-ipo-name">{ipo.name}</span>
                        </td>
                        <td className="earn-td earn-td-c">
                          {ipo.symbol
                            ? <span className="earn-symbol">{ipo.symbol}</span>
                            : <span className="earn-dim">TBD</span>}
                        </td>
                        <td className="earn-td earn-td-c earn-hide-sm">{ipo.exchange}</td>
                        <td className="earn-td earn-td-r">{ipo.price || <span className="earn-dim">—</span>}</td>
                        <td className="earn-td earn-td-r earn-hide-sm">{fmtIpoVal(ipo.totalSharesValue)}</td>
                        <td className="earn-td earn-td-c">
                          <span className={`earn-status-badge ${statusCls}`}>{ipo.status}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
