"use client";

import type { RiskResult } from "../types";

const levelColor: Record<RiskResult["level"], string> = {
  low: "#33b36b",
  medium: "#f2b327",
  high: "#e66154",
};

export default function RiskMeter({ risk }: { risk: RiskResult }) {
  const fill = Math.min(Math.max(risk.valueAtRiskPct, 0), 100);

  return (
    <section className="card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Risk Console</p>
          <h3>Position risk meter</h3>
        </div>
      </div>

      <div className="risk-bar">
        <div
          className="risk-bar-fill"
          style={{
            width: `${fill}%`,
            background: `linear-gradient(90deg, ${levelColor[risk.level]}, ${levelColor[risk.level]}aa)`,
          }}
        />
      </div>

      <div className="grid grid-3">
        <div className="metric-card">
          <span className="metric-label">Risk level</span>
          <strong style={{ color: levelColor[risk.level] }}>{risk.level.toUpperCase()}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Value at risk</span>
          <strong>{risk.valueAtRiskPct.toFixed(2)}%</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Suggested max size</span>
          <strong>{risk.recommendedPositionSizePct.toFixed(1)}%</strong>
        </div>
      </div>
    </section>
  );
}
