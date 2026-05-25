"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getReports } from "../services/api";
import type { AgentReport } from "../types";

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

export default function History() {
  const [reports, setReports] = useState<AgentReport[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "buy" | "sell" | "hold">("all");

  useEffect(() => {
    void getReports()
      .then((r) => setReports(r.reports))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load history"))
      .finally(() => setLoading(false));
  }, []);

  const buys = useMemo(() => reports.filter((r) => r.recommendation.action === "buy").length, [reports]);
  const sells = useMemo(() => reports.filter((r) => r.recommendation.action === "sell").length, [reports]);
  const holds = useMemo(() => reports.filter((r) => r.recommendation.action === "hold").length, [reports]);

  const filtered = useMemo(() =>
    filter === "all" ? reports : reports.filter((r) => r.recommendation.action === filter),
    [reports, filter]
  );

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

        {/* Stats row */}
        {reports.length > 0 && (
          <div className="hist-stats">
            <div className="findec-panel hist-stat">
              <span className="findec-kicker">Total Reports</span>
              <strong>{reports.length}</strong>
            </div>
            <div className="findec-panel hist-stat">
              <span className="findec-kicker">Buy Calls</span>
              <strong className="findec-subline-up">{buys}</strong>
            </div>
            <div className="findec-panel hist-stat">
              <span className="findec-kicker">Sell Calls</span>
              <strong className="findec-subline-down">{sells}</strong>
            </div>
            <div className="findec-panel hist-stat">
              <span className="findec-kicker">Hold Calls</span>
              <strong style={{ color: "#888" }}>{holds}</strong>
            </div>
          </div>
        )}

        {/* Filter tabs */}
        {reports.length > 0 && (
          <div className="hist-tabs">
            {(["all", "buy", "sell", "hold"] as const).map((f) => (
              <button
                key={f}
                className={`hist-tab ${filter === f ? "hist-tab-active" : ""}`}
                onClick={() => setFilter(f)}
              >
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
              const verdict = report.recommendation.verdict;
              return (
                <div key={report.id} className="findec-panel hist-card">
                  <div className="hist-card-top">
                    <div className="hist-card-left">
                      <div className="hist-card-ticker-row">
                        <Link href={`/stock/${encodeURIComponent(report.ticker)}`} className="hist-ticker">
                          {report.ticker}
                        </Link>
                        <span className={`hist-action-badge ${actionColor(action)}`}>
                          {action.toUpperCase()}
                        </span>
                        {verdict && (
                          <span className="hist-verdict">
                            {verdict === "buy_now" ? "Buy Now" : verdict === "wait" ? "Wait" : "Avoid"}
                          </span>
                        )}
                      </div>
                      <p className="hist-query">{report.query}</p>
                    </div>
                    <div className="hist-card-right">
                      <span className="hist-time">{timeAgo(report.createdAt)}</span>
                      <span className="hist-score">Score {report.score.toFixed(0)}</span>
                    </div>
                  </div>

                  <div className="hist-card-meta">
                    <span>Risk: <strong>{report.risk_profile}</strong></span>
                    <span>Budget: <strong>${report.budget.toLocaleString()}</strong></span>
                    {report.recommendation.suggestedAmount > 0 && (
                      <span>Suggested: <strong>${report.recommendation.suggestedAmount.toLocaleString()}</strong></span>
                    )}
                    <span>V{report.version}</span>
                    <span>{new Date(report.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                  </div>

                  <p className="hist-reason">{report.recommendation.reason}</p>

                  <div className="hist-card-actions">
                    <Link href={`/report/${report.id}`} className="hist-open-btn">Open Full Report →</Link>
                    <Link href={`/brief?ticker=${encodeURIComponent(report.ticker)}`} className="hist-rerun-btn">Re-run Brief</Link>
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
