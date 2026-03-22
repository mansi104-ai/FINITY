"use client";

import type { AgentReport } from "../types";
import SentimentBadge from "./SentimentBadge";

function currency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function actionLabel(action: AgentReport["recommendation"]["action"]): string {
  if (action === "buy") {
    return "Looks promising";
  }

  if (action === "sell") {
    return "Be careful";
  }

  return "Wait and watch";
}

export default function ReportCard({ report }: { report: AgentReport }) {
  if (!report?.recommendation) {
    return null;
  }

  const predictionMethod =
    report.prediction?.predictionMethod ?? "Hybrid forecast using price action, query context, and sentiment.";
  const methodFactors =
    report.prediction?.methodFactors ?? ["Legacy report: detailed method factors were not stored for this run."];

  const actionTone =
    report.recommendation.action === "buy"
      ? "trend-up"
      : report.recommendation.action === "sell"
        ? "trend-down"
        : "trend-flat";

  return (
    <section className="card recommendation-panel">
      <div className="recommendation-header">
        <div>
          <p className="eyebrow">Today&apos;s Takeaway</p>
          <h2 style={{ marginTop: 0 }}>{report.ticker} at a glance</h2>
        </div>
        <div className={`trend-chip ${actionTone}`}>{actionLabel(report.recommendation.action)}</div>
      </div>

      <div className="recommendation-grid">
        <div className="metric-card">
          <span className="metric-label">Suggested move</span>
          <strong>{actionLabel(report.recommendation.action)}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Starter amount</span>
          <strong>{currency(report.recommendation.suggestedAmount)}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Budget used</span>
          <strong>{currency(report.budget)}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Confidence</span>
          <strong>{report.prediction ? `${Math.round(report.prediction.confidence * 100)}%` : "Available in full report"}</strong>
        </div>
      </div>

      <p className="recommendation-copy">{report.recommendation.reason}</p>

      <details className="simple-details">
        <summary className="details-summary">
          <span>See why this result was chosen</span>
        </summary>

        {typeof report.recommendation.buyScore === "number" && (
          <div className="score-band">
            <div className="score-band-fill" style={{ width: `${Math.min(report.recommendation.buyScore, 100)}%` }} />
            <div className="score-band-labels">
              <span>Score {report.recommendation.buyScore.toFixed(2)}</span>
              <span>
                Target {typeof report.recommendation.buyThreshold === "number" ? report.recommendation.buyThreshold.toFixed(2) : "n/a"}
              </span>
            </div>
          </div>
        )}

        {report.prediction && (
          <article className="mini-panel" style={{ marginTop: "1rem" }}>
            <h4>How the forecast was built</h4>
            <p className="text-muted" style={{ marginTop: "0.35rem" }}>
              {predictionMethod}
            </p>
            {methodFactors.map((factor) => (
              <p key={factor} className="text-muted">
                {factor}
              </p>
            ))}
            {report.prediction.backtest && (
              <p className="text-muted">
                Past accuracy: {report.prediction.backtest.directionalAccuracyPct.toFixed(1)}% directionally correct and{" "}
                {report.prediction.backtest.maePct.toFixed(2)}% average error across {Math.round(report.prediction.backtest.samples)} samples.
              </p>
            )}
          </article>
        )}
      </details>

      <div className="tag-row">
        {report.sentiment && <SentimentBadge sentiment={report.sentiment} />}
        {report.prediction && (
          <span className="badge badge-ghost">
            Outlook {report.prediction.trend} | {Math.round(report.prediction.confidence * 100)}%
          </span>
        )}
      </div>
    </section>
  );
}
