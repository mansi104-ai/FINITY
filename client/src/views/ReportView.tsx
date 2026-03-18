"use client";

import { useEffect, useState } from "react";
import AgentStatusCard from "../components/AgentStatusCard";
import AlgorithmWorkbench from "../components/AlgorithmWorkbench";
import PriceChart from "../components/PriceChart";
import PredictionDriverGraph from "../components/PredictionDriverGraph";
import ResearchAuditCard from "../components/ResearchAuditCard";
import ReportCard from "../components/ReportCard";
import RiskMeter from "../components/RiskMeter";
import TodayTrendCard from "../components/TodayTrendCard";
import { getReport } from "../services/api";
import type { AgentReport } from "../types";

export default function ReportView({ reportId }: { reportId: string }) {
  const [report, setReport] = useState<AgentReport | null>(null);
  const [error, setError] = useState("");

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

      <div className="report-board">
        <div className="report-main-column">
          <ReportCard report={report} />
          {report.prediction && <TodayTrendCard prediction={report.prediction} />}
          {report.risk && <RiskMeter risk={report.risk} />}
          {report.prediction && <AlgorithmWorkbench prediction={report.prediction} />}
          <PredictionDriverGraph report={report} />

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
        </div>

        <aside className="report-analyst-column">
          <article className="card analyst-workspace">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Analyst Workspace</p>
                <h3>Forecast and evidence</h3>
              </div>
              <p className="text-muted">
                Inspired by open canvas layouts, this rail keeps the model view and all reviewed sources visible together.
              </p>
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
