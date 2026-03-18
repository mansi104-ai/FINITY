"use client";

import type { PredictionResult } from "../types";

type Point = { x: number; y: number };

function toPoints(series: number[], width: number, height: number): Point[] {
  const max = Math.max(...series);
  const min = Math.min(...series);
  const range = Math.max(max - min, 1);

  return series.map((value, index) => ({
    x: (index / Math.max(series.length - 1, 1)) * width,
    y: height - ((value - min) / range) * height,
  }));
}

function toPolyline(points: Point[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function areaPath(points: Point[], height: number): string {
  if (points.length === 0) {
    return "";
  }

  const start = points[0];
  const end = points[points.length - 1];
  return `M ${start.x} ${height} L ${points.map((point) => `${point.x} ${point.y}`).join(" L ")} L ${end.x} ${height} Z`;
}

export default function PriceChart({ prediction }: { prediction: PredictionResult }) {
  const width = 720;
  const height = 260;
  const historyWidth = 430;
  const forecastOffset = 400;
  const historyPoints = toPoints(prediction.history, historyWidth, height);
  const forecastSeries = [prediction.history[prediction.history.length - 1], ...prediction.forecast];
  const forecastPoints = toPoints(forecastSeries, width - forecastOffset - 24, height).map((point) => ({
    x: point.x + forecastOffset,
    y: point.y,
  }));
  const combined = [...prediction.history, ...prediction.forecast];
  const max = Math.max(...combined);
  const min = Math.min(...combined);
  const yMarks = Array.from({ length: 5 }, (_, index) => max - ((max - min) / 4) * index);
  const trendClass =
    prediction.trend === "bullish" ? "trend-up" : prediction.trend === "bearish" ? "trend-down" : "trend-flat";

  return (
    <section className="card chart-panel">
      <div className="chart-header">
        <div>
          <p className="eyebrow">Analyst Tape</p>
          <h3>{prediction.ticker} price structure</h3>
        </div>
        <div className={`trend-chip ${trendClass}`}>
          {prediction.trend} | {Math.round(prediction.confidence * 100)}% confidence
        </div>
      </div>

      <div className="chart-kpis">
        <div className="metric-card">
          <span className="metric-label">Current</span>
          <strong>${prediction.currentPrice.toFixed(2)}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Target</span>
          <strong>${prediction.predictedPrice.toFixed(2)}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Expected move</span>
          <strong>{prediction.predictedReturnPct.toFixed(2)}%</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Volatility band</span>
          <strong>+/-{prediction.volatilityBandPct.toFixed(2)}%</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Decision horizon</span>
          <strong>{prediction.horizonLabel}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Query alignment</span>
          <strong>{Math.round(prediction.queryAlignment * 100)}%</strong>
        </div>
      </div>

      <div className="chart-shell">
        <div className="chart-axis-labels">
          {yMarks.map((mark) => (
            <span key={mark}>${mark.toFixed(2)}</span>
          ))}
        </div>

        <svg
          viewBox={`0 0 ${width} ${height + 24}`}
          width="100%"
          className="market-chart"
          aria-label="Stock market style price chart"
        >
          <defs>
            <linearGradient id="historyFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(64, 192, 122, 0.35)" />
              <stop offset="100%" stopColor="rgba(64, 192, 122, 0.02)" />
            </linearGradient>
            <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(0, 214, 201, 0.28)" />
              <stop offset="100%" stopColor="rgba(0, 214, 201, 0.03)" />
            </linearGradient>
          </defs>

          {yMarks.map((_, index) => {
            const y = (height / 4) * index;
            return <line key={y} x1="0" y1={y} x2={width} y2={y} className="chart-grid-line" />;
          })}

          <line x1={forecastOffset - 22} y1="0" x2={forecastOffset - 22} y2={height} className="chart-divider" />
          <path d={areaPath(historyPoints, height)} fill="url(#historyFill)" />
          <path d={areaPath(forecastPoints, height)} fill="url(#forecastFill)" />
          <polyline fill="none" stroke="#56d364" strokeWidth="3.5" points={toPolyline(historyPoints)} />
          <polyline fill="none" stroke="#00d6c9" strokeWidth="3.5" strokeDasharray="7 7" points={toPolyline(forecastPoints)} />

          {historyPoints.length > 0 && (
            <circle
              cx={historyPoints[historyPoints.length - 1].x}
              cy={historyPoints[historyPoints.length - 1].y}
              r="4.5"
              fill="#56d364"
            />
          )}
          {forecastPoints.length > 0 && (
            <circle
              cx={forecastPoints[forecastPoints.length - 1].x}
              cy={forecastPoints[forecastPoints.length - 1].y}
              r="5"
              fill="#00d6c9"
            />
          )}

          <text x="20" y={height + 18} className="chart-caption">
            Historical tape
          </text>
          <text x={forecastOffset} y={height + 18} className="chart-caption">
            Forward path
          </text>
        </svg>
      </div>

      <p className="text-muted chart-summary">{prediction.analystSummary}</p>

      <div className="grid grid-2">
        <article className="mini-panel">
          <h4>Key levels</h4>
          <p>
            Support: <strong>${prediction.supportLevel.toFixed(2)}</strong>
          </p>
          <p>
            Resistance: <strong>${prediction.resistanceLevel.toFixed(2)}</strong>
          </p>
        </article>
        <article className="mini-panel">
          <h4>Signal stack</h4>
          {prediction.signals.map((signal) => (
            <p key={signal}>{signal}</p>
          ))}
        </article>
      </div>

      <div className="scenario-strip">
        {prediction.scenarios.map((scenario) => (
          <article key={scenario.label} className="scenario-card">
            <span className="metric-label">{scenario.label}</span>
            <strong>${scenario.price.toFixed(2)}</strong>
            <span className={scenario.returnPct >= 0 ? "return-positive" : "return-negative"}>
              {scenario.returnPct >= 0 ? "+" : ""}
              {scenario.returnPct.toFixed(2)}%
            </span>
            <p className="text-muted" style={{ marginBottom: 0 }}>
              {scenario.reason}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
