"use client";

import type { PredictionResult } from "../types";

function formatDate(value?: string | null): string {
  if (!value) {
    return "Latest session not available";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function TodayTrendCard({ prediction }: { prediction: PredictionResult }) {
  if (!prediction.todayTrend) {
    return null;
  }

  const { todayTrend } = prediction;
  const directionTone =
    todayTrend.direction === "up"
      ? "trend-up"
      : todayTrend.direction === "down"
        ? "trend-down"
        : "trend-flat";

  return (
    <section className="card verification-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Today Verification</p>
          <h3>Recent-session trend check</h3>
        </div>
        <div className={`trend-chip ${directionTone}`}>{todayTrend.direction.toUpperCase()}</div>
      </div>

      <p className="text-muted" style={{ marginTop: 0 }}>
        This is a short-window tape estimate built only from the last few daily closes, so users can cross-check the
        likely direction even when the market is closed.
      </p>

      <div className="recommendation-grid">
        <div className="metric-card">
          <span className="metric-label">Projected today move</span>
          <strong>
            {todayTrend.projectedMovePct >= 0 ? "+" : ""}
            {todayTrend.projectedMovePct.toFixed(2)}%
          </strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Confidence</span>
          <strong>{Math.round(todayTrend.confidence * 100)}%</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Based on</span>
          <strong>Last {todayTrend.basedOnDays} sessions</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Last session</span>
          <strong>{formatDate(todayTrend.lastSessionDate)}</strong>
        </div>
      </div>

      <article className="mini-panel">
        <h4>Method</h4>
        <p className="text-muted">{todayTrend.method}</p>
      </article>
    </section>
  );
}
