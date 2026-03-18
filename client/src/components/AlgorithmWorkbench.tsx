"use client";

import type { PredictionResult } from "../types";

export default function AlgorithmWorkbench({ prediction }: { prediction: PredictionResult }) {
  const backtest = prediction.backtest;

  return (
    <section className="card algorithm-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Algorithm Workbench</p>
          <h3>What the trader model is doing</h3>
        </div>
        <p className="text-muted">
          Transparent summary of model type, calibration, and performance so advanced users can judge the forecast.
        </p>
      </div>

      <div className="grid grid-2">
        <article className="mini-panel">
          <h4>Forecast engine</h4>
          <p className="text-muted">{prediction.predictionMethod}</p>
        </article>
        <article className="mini-panel">
          <h4>Live calibration</h4>
          <p className="text-muted">
            Confidence: {Math.round(prediction.confidence * 100)}% | Query alignment: {Math.round(prediction.queryAlignment * 100)}%
          </p>
        </article>
      </div>

      <div className="algorithm-flow">
        <div className="algorithm-step">
          <span className="brief-index">01</span>
          <div>
            <strong>Historical market data</strong>
            <p className="text-muted">Daily price history is used as the base signal layer for the asset-specific model.</p>
          </div>
        </div>
        <div className="algorithm-step">
          <span className="brief-index">02</span>
          <div>
            <strong>Macro and query overlay</strong>
            <p className="text-muted">The query is parsed for events like tariffs, OPEC, inflation, Fed, earnings, and regime-specific cues.</p>
          </div>
        </div>
        <div className="algorithm-step">
          <span className="brief-index">03</span>
          <div>
            <strong>Backtest-calibrated confidence</strong>
            <p className="text-muted">Confidence is based on historical directional accuracy and model error rather than fixed heuristics.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-3">
        {prediction.methodFactors.map((factor) => (
          <article key={factor} className="mini-panel">
            <p className="text-muted" style={{ margin: 0 }}>{factor}</p>
          </article>
        ))}
      </div>

      {backtest && (
        <div className="chart-kpis">
          <div className="metric-card">
            <span className="metric-label">Backtest samples</span>
            <strong>{Math.round(backtest.samples)}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Directional accuracy</span>
            <strong>{backtest.directionalAccuracyPct.toFixed(1)}%</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">MAE</span>
            <strong>{backtest.maePct.toFixed(2)}%</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">RMSE</span>
            <strong>{backtest.rmsePct.toFixed(2)}%</strong>
          </div>
        </div>
      )}
    </section>
  );
}
