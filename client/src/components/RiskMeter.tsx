"use client";

import type { RiskResult } from "../types";

const levelColor: Record<RiskResult["level"], string> = {
  low: "#2b8a3e",
  medium: "#f08c00",
  high: "#c92a2a"
};

export default function RiskMeter({ risk }: { risk: RiskResult }) {
  const fill = Math.min(Math.max(risk.valueAtRiskPct, 0), 100);

  return (
    <section className="card">
      <h3>Risk Meter</h3>
      <div style={{ marginTop: "0.75rem", height: 16, borderRadius: 999, background: "#e9ecef", overflow: "hidden" }}>
        <div
          style={{
            width: `${fill}%`,
            height: "100%",
            background: levelColor[risk.level],
            transition: "width 0.3s ease"
          }}
        />
      </div>
      <p style={{ marginBottom: 0 }}>
        Risk: <strong style={{ color: levelColor[risk.level] }}>{risk.level.toUpperCase()}</strong> | VaR: {risk.valueAtRiskPct.toFixed(2)}%
      </p>
      <p className="text-muted" style={{ marginTop: "0.2rem" }}>
        Recommended max position size: {risk.recommendedPositionSizePct.toFixed(1)}% of available budget.
      </p>
    </section>
  );
}
