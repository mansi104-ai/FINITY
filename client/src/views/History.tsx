"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getReports, getStockDetail, getSessionUser, subscribeToAuthChanges } from "../services/api";
import type { AgentReport, StockQuote } from "../types";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

type Verdict = "right" | "wrong" | "pending";

// Evaluate whether the AI's call has played out vs. the price at the time of the brief.
function evaluate(action: string, priceAtCall: number | undefined, priceNow: number | undefined, ageDays: number): { verdict: Verdict; ret: number | null } {
  if (priceAtCall == null || priceAtCall <= 0 || priceNow == null) return { verdict: "pending", ret: null };
  const ret = ((priceNow - priceAtCall) / priceAtCall) * 100;
  if (ageDays < 1) return { verdict: "pending", ret };
  let right: boolean;
  if (action === "buy") right = ret > 1;
  else if (action === "sell") right = ret < -1;
  else right = Math.abs(ret) <= 5; // hold = stayed roughly flat
  return { verdict: right ? "right" : "wrong", ret };
}

const ACTION_CLS: Record<string, string> = { buy: "hist-action-buy", sell: "hist-action-sell", hold: "hist-action-hold" };

export default function History() {
  const [reports, setReports] = useState<AgentReport[]>([]);
  const [quotes, setQuotes] = useState<Record<string, StockQuote | null>>({});
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "right" | "wrong" | "pending">("all");

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

  // Current price per unique ticker → judge each call against actual movement.
  useEffect(() => {
    if (!signedIn || reports.length === 0) return;
    const tickers = Array.from(new Set(reports.map((r) => r.ticker)));
    tickers.forEach((t) => {
      if (t in quotes) return;
      void getStockDetail(t)
        .then((q) => setQuotes((p) => ({ ...p, [t]: q })))
        .catch(() => setQuotes((p) => ({ ...p, [t]: null })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, reports]);

  const rows = useMemo(() => reports.map((r) => {
    const priceAtCall = r.prediction?.currentPrice;
    const priceNow = quotes[r.ticker]?.price;
    const { verdict, ret } = evaluate(r.recommendation.action, priceAtCall, priceNow, daysSince(r.createdAt));
    return { r, priceAtCall, priceNow, verdict, ret };
  }), [reports, quotes]);

  const stats = useMemo(() => {
    const resolved = rows.filter((x) => x.verdict !== "pending");
    const right = resolved.filter((x) => x.verdict === "right").length;
    const buyRets = rows.filter((x) => x.r.recommendation.action === "buy" && x.ret != null).map((x) => x.ret as number);
    const avgBuy = buyRets.length ? buyRets.reduce((a, b) => a + b, 0) / buyRets.length : null;
    return {
      total: reports.length,
      hitRate: resolved.length ? Math.round((right / resolved.length) * 100) : null,
      resolved: resolved.length,
      avgBuy,
    };
  }, [rows, reports.length]);

  const filtered = useMemo(() => filter === "all" ? rows : rows.filter((x) => x.verdict === filter), [rows, filter]);

  if (!signedIn) {
    return (
      <section className="findec-minimal-page">
        <div className="findec-minimal-shell">
          <div className="findec-panel hist-empty">
            <p className="hist-empty-title">Sign in to view your track record</p>
            <p className="hist-empty-sub">Your AI Brief calls and how they played out are private to your account.</p>
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
            <p className="findec-kicker">AI Track Record</p>
            <h1 className="hist-title">How your briefs played out</h1>
          </div>
          <Link href="/brief" className="hist-new-btn">+ New Brief</Link>
        </div>

        {reports.length > 0 && (
          <div className="hist-stats">
            <div className="findec-panel hist-stat"><span className="findec-kicker">Briefs</span><strong>{stats.total}</strong></div>
            <div className="findec-panel hist-stat">
              <span className="findec-kicker">Hit Rate</span>
              <strong className={stats.hitRate == null ? "" : stats.hitRate >= 50 ? "findec-subline-up" : "findec-subline-down"}>
                {stats.hitRate == null ? "—" : `${stats.hitRate}%`}
              </strong>
            </div>
            <div className="findec-panel hist-stat"><span className="findec-kicker">Resolved</span><strong>{stats.resolved}</strong></div>
            <div className="findec-panel hist-stat">
              <span className="findec-kicker">Avg Buy Move</span>
              <strong className={stats.avgBuy == null ? "" : stats.avgBuy >= 0 ? "findec-subline-up" : "findec-subline-down"}>
                {stats.avgBuy == null ? "—" : `${stats.avgBuy >= 0 ? "+" : ""}${stats.avgBuy.toFixed(1)}%`}
              </strong>
            </div>
          </div>
        )}

        {reports.length > 0 && (
          <div className="hist-tabs">
            {(["all", "right", "wrong", "pending"] as const).map((f) => (
              <button key={f} className={`hist-tab ${filter === f ? "hist-tab-active" : ""}`} onClick={() => setFilter(f)}>
                {f === "all" ? `All (${rows.length})` : f === "right" ? "✓ Right" : f === "wrong" ? "✗ Wrong" : "⏳ Pending"}
              </button>
            ))}
          </div>
        )}

        {error && <div className="findec-panel hist-error">{error}</div>}
        {loading && <p className="findec-kicker hist-loading">Loading track record…</p>}

        {!loading && !error && reports.length === 0 && (
          <div className="findec-panel hist-empty">
            <p className="hist-empty-title">No briefs yet</p>
            <p className="hist-empty-sub">Run an AI Brief on any stock — then come back to see whether the call played out.</p>
            <Link href="/brief" className="hist-empty-cta">Run AI Brief →</Link>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="hist-list">
            {filtered.map(({ r, priceAtCall, priceNow, verdict, ret }) => {
              const action = r.recommendation.action;
              const company = quotes[r.ticker]?.name ?? r.ticker;
              const predicted = r.prediction?.predictedReturnPct;
              return (
                <div key={r.id} className={`findec-panel hist-card hist-v-${verdict}`}>
                  <div className="hist-card-top">
                    <div className="hist-card-left">
                      <div className="hist-card-ticker-row">
                        <Link href={`/stock/${encodeURIComponent(r.ticker)}`} className="hist-ticker">{r.ticker}</Link>
                        <span className="hist-company-name">{company}</span>
                        <span className={`hist-action-badge ${ACTION_CLS[action]}`}>{action.toUpperCase()}</span>
                        <span className={`hist-verdict-chip hist-verdict-${verdict}`}>
                          {verdict === "right" ? "✓ Played out" : verdict === "wrong" ? "✗ Missed" : "⏳ Pending"}
                        </span>
                      </div>
                      <p className="hist-query">{r.query}</p>
                    </div>
                    <div className="hist-card-right">
                      <span className="hist-time">{fmtDate(r.createdAt)} · {daysSince(r.createdAt)}d ago</span>
                      <span className="hist-score">AI score {r.score.toFixed(0)}</span>
                    </div>
                  </div>

                  {/* Call vs. actual outcome */}
                  <div className="hist-outcome">
                    <div className="hist-outcome-cell">
                      <span>Called at</span>
                      <strong>{priceAtCall != null ? priceAtCall.toFixed(2) : "—"}</strong>
                    </div>
                    <div className="hist-outcome-arrow">→</div>
                    <div className="hist-outcome-cell">
                      <span>Now</span>
                      <strong>{priceNow != null ? priceNow.toFixed(2) : "—"}</strong>
                    </div>
                    <div className="hist-outcome-cell">
                      <span>Since call</span>
                      <strong className={ret == null ? "" : ret >= 0 ? "findec-subline-up" : "findec-subline-down"}>
                        {ret == null ? "—" : `${ret >= 0 ? "+" : ""}${ret.toFixed(2)}%`}
                      </strong>
                    </div>
                    {predicted != null && (
                      <div className="hist-outcome-cell">
                        <span>AI predicted</span>
                        <strong className={predicted >= 0 ? "findec-subline-up" : "findec-subline-down"}>
                          {predicted >= 0 ? "+" : ""}{predicted.toFixed(2)}%
                        </strong>
                      </div>
                    )}
                  </div>

                  <p className="hist-reason">{r.recommendation.reason}</p>

                  <div className="hist-card-actions">
                    <Link href={`/report/${r.id}`} className="hist-open-btn">Open full report →</Link>
                    <Link href={`/brief?ticker=${encodeURIComponent(r.ticker)}`} className="hist-rerun-btn">Re-run brief</Link>
                    <Link href={`/stock/${encodeURIComponent(r.ticker)}`} className="hist-stock-btn">Stock detail</Link>
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
