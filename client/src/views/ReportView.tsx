"use client";

import { useEffect, useState } from "react";
import ResearchAuditCard from "../components/ResearchAuditCard";
import PriceChart from "../components/PriceChart";
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
      <div className="report-board">
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
