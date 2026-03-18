"use client";

import type { AgentReport } from "../types";
import SentimentBadge from "./SentimentBadge";

function currency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
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
          <p className="eyebrow">Decision Engine</p>
          <h2 style={{ marginTop: 0 }}>{report.ticker} recommendation</h2>
        </div>
        <div className={`trend-chip ${actionTone}`}>{report.recommendation.action.toUpperCase()}</div>
      </div>

      <div className="recommendation-grid">
        <div className="metric-card">
          <span className="metric-label">Budget deployed</span>
          <strong>{currency(report.budget)}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Suggested size</span>
          <strong>{currency(report.recommendation.suggestedAmount)}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Verdict</span>
          <strong>{report.recommendation.verdict ?? "monitor"}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Model version</span>
          <strong>V{report.version}</strong>
        </div>
      </div>

      <p className="recommendation-copy">{report.recommendation.reason}</p>

      {typeof report.recommendation.buyScore === "number" && (
        <div className="score-band">
          <div className="score-band-fill" style={{ width: `${Math.min(report.recommendation.buyScore, 100)}%` }} />
          <div className="score-band-labels">
            <span>Buy score {report.recommendation.buyScore.toFixed(2)}</span>
            <span>
              Threshold {typeof report.recommendation.buyThreshold === "number" ? report.recommendation.buyThreshold.toFixed(2) : "n/a"}
            </span>
          </div>
        </div>
      )}

      {report.prediction && (
        <article className="mini-panel" style={{ marginTop: "1rem" }}>
          <h4>How the analyst predicted this</h4>
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
              Backtest: {report.prediction.backtest.directionalAccuracyPct.toFixed(1)}% directional accuracy,{" "}
              {report.prediction.backtest.maePct.toFixed(2)}% MAE over {Math.round(report.prediction.backtest.samples)} samples.
            </p>
          )}
        </article>
      )}

      <div className="tag-row">
        {report.sentiment && <SentimentBadge sentiment={report.sentiment} />}
        {report.prediction && (
          <span className="badge badge-ghost">
            Analyst {report.prediction.trend} | {Math.round(report.prediction.confidence * 100)}%
          </span>
        )}
      </div>
    </section>
  );
}
