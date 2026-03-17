"use client";

import type { AgentReport } from "../types";
import SentimentBadge from "./SentimentBadge";

export default function ReportCard({ report }: { report: AgentReport }) {
  return (
    <section className="card">
      <h3>Final Recommendation</h3>
      <p style={{ marginTop: "0.35rem" }}>
        <strong style={{ textTransform: "uppercase" }}>{report.recommendation.action}</strong> {report.ticker} with suggested amount ${report.recommendation.suggestedAmount.toFixed(2)}
      </p>
      <p className="text-muted">{report.recommendation.reason}</p>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {report.sentiment && <SentimentBadge sentiment={report.sentiment} />}
        <span className="badge" style={{ background: "#e7f5ff", color: "#1971c2" }}>
          Version {report.version}
        </span>
      </div>
    </section>
  );
}
