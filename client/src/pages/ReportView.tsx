"use client";

import { useEffect, useState } from "react";
import AgentStatusCard from "../components/AgentStatusCard";
import PriceChart from "../components/PriceChart";
import ReportCard from "../components/ReportCard";
import RiskMeter from "../components/RiskMeter";
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
      <section className="card" style={{ marginTop: "1rem" }}>
        <p style={{ color: "#c92a2a" }}>{error}</p>
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
    <section className="grid" style={{ marginTop: "1rem" }}>
      <article className="card">
        <h2>Report {report.id}</h2>
        <p className="text-muted">
          Query: {report.query} | Generated: {new Date(report.createdAt).toLocaleString()}
        </p>
      </article>
      <ReportCard report={report} />
      {report.prediction && <PriceChart prediction={report.prediction} />}
      {report.risk && <RiskMeter risk={report.risk} />}
      <AgentStatusCard statuses={report.agentLogs} />
    </section>
  );
}
