"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getReports, getMarketHistory, getStocks, getSessionUser, subscribeToAuthChanges } from "../services/api";
import type { AgentReport, MarketHistory, StockQuote } from "../types";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(h / 24);
  if (h < 1) return `${Math.floor(diff / 60000)}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function actionColor(action: string): string {
  if (action === "buy") return "hist-action-buy";
  if (action === "sell") return "hist-action-sell";
  return "hist-action-hold";
}

// Mini marked line graph: close series with high/low dots.
function MiniGraph({ history }: { history: MarketHistory }) {
  const pts = history.points;
  if (pts.length < 2) return null;
  const W = 260, H = 64, pad = 4;
  const closes = pts.map((p) => p.close);
  const min = Math.min(...closes), max = Math.max(...closes);
  const range = Math.max(max - min, 0.01);
  const x = (i: number) => pad + (i / (pts.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - min) / range) * (H - pad * 2);
  const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.close).toFixed(1)}`).join(" ");
  const hiIdx = closes.indexOf(max), loIdx = closes.indexOf(min);
  const up = pts[pts.length - 1].close >= pts[0].close;
  const stroke = up ? "#33b36b" : "#cc5147";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="64" className="hist-mini-graph" aria-label="30-day price">
      <polyline fill="none" stroke={stroke} strokeWidth="1.6" points={line} />
      <circle cx={x(hiIdx)} cy={y(max)} r="2.6" fill="#33b36b" />
      <circle cx={x(loIdx)} cy={y(min)} r="2.6" fill="#cc5147" />
    </svg>
  );
}

export default function History() {
  const [reports, setReports] = useState<AgentReport[]>([]);
  const [histories, setHistories] = useState<Record<string, MarketHistory>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [peers, setPeers] = useState<StockQuote[]>([]);
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "buy" | "sell" | "hold">("all");

  useEffect(() => {
    const sync = () => {
      const isIn = getSessionUser() !== null;
      setSignedIn(isIn);
      if (!isIn) { setReports([]); setLoading(false); }
    };
    sync();
    return subscribeToAuthChanges(sync);
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    setLoading(true);
    void getReports()
      .then((r) => setReports(r.reports))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load history"))
      .finally(() => setLoading(false));
  }, [signedIn]);

  // Enrich: company names + same-geolocation peers from the live stock list.
  useEffect(() => {
    if (!signedIn || reports.length === 0) return;
    void getStocks()
      .then((res) => {
        const nameMap: Record<string, string> = {};
        for (const s of res.stocks) nameMap[s.symbol] = s.name;
        setNames(nameMap);
        setPeers(res.stocks);
      })
      .catch(() => { /* names optional */ });
  }, [signedIn, reports]);

  // Fetch 30-day history for each unique ticker (marked graph + high/low).
  useEffect(() => {
    if (!signedIn) return;
    const tickers = Array.from(new Set(reports.map((r) => r.ticker)));
    tickers.forEach((t) => {
      if (histories[t]) return;
      void getMarketHistory(t)
        .then((h) => setHistories((prev) => ({ ...prev, [t]: h })))
        .catch(() => { /* graph optional */ });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, reports]);

  const buys = useMemo(() => reports.filter((r) => r.recommendation.action === "buy").length, [reports]);
  const sells = useMemo(() => reports.filter((r) => r.recommendation.action === "sell").length, [reports]);
  const holds = useMemo(() => reports.filter((r) => r.recommendation.action === "hold").length, [reports]);

  const filtered = useMemo(() =>
    filter === "all" ? reports : reports.filter((r) => r.recommendation.action === filter),
    [reports, filter]
  );

  function competitorsFor(ticker: string): StockQuote[] {
    // Same-market (geolocation) peers: other tickers from the live geo stock list.
    return peers.filter((p) => p.symbol !== ticker).slice(0, 4);
  }

  if (!signedIn) {
    return (
      <section className="findec-minimal-page">
        <div className="findec-minimal-shell">
          <div className="findec-panel hist-empty">
            <p className="hist-empty-title">Sign in to view your brief history</p>
            <p className="hist-empty-sub">Your saved AI Brief reports are private to your account.</p>
            <Link href="/login" className="hist-empty-cta">Login →</Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="findec-minimal-page">
      <div className="findec-minimal-shell">
        <div className="hist-header">
          <div>
            <p className="findec-kicker">Report Archive</p>
            <h1 className="hist-title">AI Brief History</h1>
          </div>
          <Link href="/brief" className="hist-new-btn">+ New Brief</Link>
        </div>

        {reports.length > 0 && (
          <div className="hist-stats">
            <div className="findec-panel hist-stat"><span className="findec-kicker">Total Reports</span><strong>{reports.length}</strong></div>
            <div className="findec-panel hist-stat"><span className="findec-kicker">Buy Calls</span><strong className="findec-subline-up">{buys}</strong></div>
            <div className="findec-panel hist-stat"><span className="findec-kicker">Sell Calls</span><strong className="findec-subline-down">{sells}</strong></div>
            <div className="findec-panel hist-stat"><span className="findec-kicker">Hold Calls</span><strong style={{ color: "#888" }}>{holds}</strong></div>
          </div>
        )}

        {reports.length > 0 && (
          <div className="hist-tabs">
            {(["all", "buy", "sell", "hold"] as const).map((f) => (
              <button key={f} className={`hist-tab ${filter === f ? "hist-tab-active" : ""}`} onClick={() => setFilter(f)}>
                {f === "all" ? `All (${reports.length})` : f === "buy" ? `Buy (${buys})` : f === "sell" ? `Sell (${sells})` : `Hold (${holds})`}
              </button>
            ))}
          </div>
        )}

        {error && <div className="findec-panel hist-error">{error}</div>}
        {loading && <p className="findec-kicker hist-loading">Loading history…</p>}

        {!loading && !error && reports.length === 0 && (
          <div className="findec-panel hist-empty">
            <p className="hist-empty-title">No reports yet</p>
            <p className="hist-empty-sub">Run an AI Brief on any stock to generate your first analysis report.</p>
            <Link href="/brief" className="hist-empty-cta">Run AI Brief →</Link>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="hist-list">
            {filtered.map((report) => {
              const action = report.recommendation.action;
              const hist = histories[report.ticker];
              const company = names[report.ticker] ?? report.ticker;
              const comps = competitorsFor(report.ticker);
              return (
                <div key={report.id} className="findec-panel hist-card">
                  <div className="hist-card-top">
                    <div className="hist-card-left">
                      <div className="hist-card-ticker-row">
                        <Link href={`/stock/${encodeURIComponent(report.ticker)}`} className="hist-ticker">{report.ticker}</Link>
                        <span className="hist-company-name">{company}</span>
                        <span className={`hist-action-badge ${actionColor(action)}`}>{action.toUpperCase()}</span>
                      </div>
                      <p className="hist-query">{report.query}</p>
                    </div>
                    <div className="hist-card-right">
                      <span className="hist-time">{timeAgo(report.createdAt)}</span>
                      <span className="hist-score">Score {report.score.toFixed(0)}</span>
                    </div>
                  </div>

                  {/* Summary */}
                  <p className="hist-reason">{report.recommendation.reason}</p>

                  {/* 30-day marked graph + high/low */}
                  {hist && (
                    <div className="hist-graph-block">
                      <MiniGraph history={hist} />
                      <div className="hist-graph-stats">
                        <div><span>30d High</span><strong className="findec-subline-up">{hist.high30d.toFixed(2)}</strong></div>
                        <div><span>30d Low</span><strong className="findec-subline-down">{hist.low30d.toFixed(2)}</strong></div>
                        <div><span>30d Return</span><strong className={hist.changePercent30d >= 0 ? "findec-subline-up" : "findec-subline-down"}>{hist.changePercent30d >= 0 ? "+" : ""}{hist.changePercent30d.toFixed(2)}%</strong></div>
                        <div><span>Last</span><strong>{hist.latestClose.toFixed(2)}</strong></div>
                      </div>
                    </div>
                  )}

                  {/* Competitors in the same market */}
                  {comps.length > 0 && (
                    <div className="hist-competitors">
                      <span className="findec-kicker">Competitors in your market</span>
                      <div className="hist-comp-row">
                        {comps.map((c) => (
                          <Link key={c.symbol} href={`/stock/${encodeURIComponent(c.symbol)}`} className="hist-comp-chip">
                            {c.symbol}
                            <em className={c.changePercent >= 0 ? "findec-subline-up" : "findec-subline-down"}>
                              {c.changePercent >= 0 ? "+" : ""}{c.changePercent.toFixed(2)}%
                            </em>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="hist-card-actions">
                    <Link href={`/report/${report.id}`} className="hist-open-btn">Open Full Report →</Link>
                    <Link href={`/brief?ticker=${encodeURIComponent(report.ticker)}`} className="hist-rerun-btn">Generate Brief</Link>
                    <Link href={`/stock/${encodeURIComponent(report.ticker)}`} className="hist-stock-btn">Stock Detail</Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
