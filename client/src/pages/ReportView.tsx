"use client";

import { useEffect, useState } from "react";
import AgentStatusCard from "../components/AgentStatusCard";
import PriceChart from "../components/PriceChart";
import ResearchAuditCard from "../components/ResearchAuditCard";
import ReportCard from "../components/ReportCard";
import RiskMeter from "../components/RiskMeter";
import { getReport } from "../services/api";
import { useAuth } from "../context/AuthContext";
import type { AgentReport } from "../types";

export default function ReportView({ reportId }: { reportId: string }) {
  const { token } = useAuth();
  const [report, setReport] = useState<AgentReport | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      return;
    }

    const run = async () => {
      try {
        const result = await getReport(reportId);
        setReport(result.report);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load report");
      }
    };

    void run();
  }, [reportId, token]);

  if (!token) {
    return (
      <section className="card" style={{ marginTop: "1rem" }}>
        <p>Please login from Query page to view this report.</p>
      </section>
    );
  }

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
    <section className="grid page-shell">
      <article className="hero-panel">
        <div>
          <p className="eyebrow">Detailed Report</p>
          <h1 className="hero-title">{report.ticker} execution brief</h1>
          <p className="hero-copy">
            Query: {report.query}
          </p>
        </div>
        <div className="hero-strip">
          <div className="metric-card">
            <span className="metric-label">Generated</span>
            <strong>{new Date(report.createdAt).toLocaleString()}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Budget</span>
            <strong>${report.budget.toFixed(0)}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Version</span>
            <strong>V{report.version}</strong>
          </div>
        </div>
      </article>

      <ReportCard report={report} />
      {report.prediction && <PriceChart prediction={report.prediction} />}
      {report.risk && <RiskMeter risk={report.risk} />}
      {report.sentiment && <ResearchAuditCard sentiment={report.sentiment} />}

      {report.recommendation.decisionTrace && report.recommendation.decisionTrace.length > 0 && (
        <article className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Decision Path</p>
              <h3>Why the system landed here</h3>
            </div>
          </div>
          <div className="grid">
            {report.recommendation.decisionTrace.map((entry, index) => (
              <div key={`${entry.stage}-${index}`} className="audit-card">
                <p style={{ marginTop: 0 }}>
                  <strong>{entry.stage}</strong>
                </p>
                <p className="text-muted">{entry.detail}</p>
                <p style={{ marginBottom: 0 }}>{entry.outcome}</p>
              </div>
            ))}
          </div>
        </article>
      )}

      <AgentStatusCard statuses={report.agentLogs} />
    </section>
  );
}
