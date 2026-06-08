"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ResearchAuditCard from "../components/ResearchAuditCard";
import PriceChart from "../components/PriceChart";
import { getReport, shareReport } from "../services/api";
import type { AgentReport } from "../types";

export default function ReportView({ reportId }: { reportId: string }) {
  const [report, setReport] = useState<AgentReport | null>(null);
  const [error, setError] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [shareMsg, setShareMsg] = useState("");

  const onShare = async () => {
    setShareMsg("Generating link…");
    try {
      const { slug } = await shareReport(reportId);
      const url = `${window.location.origin}/r/${slug}`;
      setShareUrl(url);
      try { await navigator.clipboard.writeText(url); setShareMsg("Public link copied to clipboard"); }
      catch { setShareMsg("Public link ready"); }
    } catch (e) {
      setShareMsg(e instanceof Error ? e.message : "Could not create share link.");
    }
  };

  useEffect(() => {
    const run = async () => {
      try {
        const result = await getReport(reportId);
        setReport(result.report);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load report");
      }
    };

    void run();
  }, [reportId]);

  if (error) {
    return (
      <section className="card danger-card" style={{ marginTop: "1rem" }}>
        <p>{error}</p>
      </section>
    );
  }

  if (!report) {
    return (
      <section className="card" style={{ marginTop: "1rem" }}>
        <p>Loading report...</p>
      </section>
    );
  }

  return (
    <section className="grid page-shell report-printable">
      <div className="report-actions no-print">
        <button className="button button-secondary" onClick={() => window.print()}>⤓ Export PDF</button>
        <button className="button button-secondary" onClick={() => void onShare()}>🔗 Share</button>
        {shareMsg && <span className="report-share-msg">{shareMsg}</span>}
        {shareUrl && (
          <a className="report-share-link" href={shareUrl} target="_blank" rel="noopener noreferrer">{shareUrl}</a>
        )}
      </div>
      <article className="hero-panel">
        <div>
          <p className="eyebrow">Saved Report</p>
          <h1 className="hero-title">{report.ticker} decision record</h1>
          <p className="hero-copy">{report.query}</p>
        </div>
        <div className="hero-strip">
          <div className="metric-card">
            <span className="metric-label">Action</span>
            <strong>{report.recommendation.action.toUpperCase()}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Risk profile</span>
            <strong>{report.risk_profile}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Score</span>
            <strong>{report.score.toFixed(2)}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Saved</span>
            <strong>{new Date(report.createdAt).toLocaleString()}</strong>
          </div>
        </div>
      </article>

      <div className="report-board">
        <div className="report-main-column">
          <article className="card recommendation-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Recommendation</p>
                <h3>Final decision</h3>
              </div>
              <Link className="button button-secondary" href="/report">
                Back to archive
              </Link>
            </div>
            <p className="recommendation-copy">{report.recommendation.reason}</p>
            <p className="recommendation-disclaimer">{report.disclaimer}</p>
            <div className="recommendation-grid">
              <div className="metric-card">
                <span className="metric-label">Suggested amount</span>
                <strong>{report.recommendation.suggestedAmount.toFixed(2)}</strong>
              </div>
              <div className="metric-card">
                <span className="metric-label">Budget</span>
                <strong>{report.budget.toFixed(2)}</strong>
              </div>
              <div className="metric-card">
                <span className="metric-label">Version</span>
                <strong>V{report.version}</strong>
              </div>
            </div>
          </article>
        </div>

        <aside className="report-analyst-column-compact">
          <article className="card analyst-workspace-compact">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Analyst Workspace</p>
                <h3>Forecast</h3>
              </div>
            </div>
            {report.prediction ? (
              <PriceChart prediction={report.prediction} />
            ) : (
              <div className="mini-panel">
                <p className="text-muted" style={{ margin: 0 }}>
                  No analyst forecast is available for this report.
                </p>
              </div>
            )}
          </article>

          {report.sentiment && <ResearchAuditCard sentiment={report.sentiment} />}
        </aside>
      </div>
    </section>
  );
}
