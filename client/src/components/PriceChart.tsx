"use client";

import type { PredictionResult } from "../types";

type Point = { x: number; y: number };

function toPoints(series: number[], width = 320, height = 120): Point[] {
  const max = Math.max(...series);
  const min = Math.min(...series);
  const range = Math.max(max - min, 1);

  return series.map((value, index) => ({
    x: (index / Math.max(series.length - 1, 1)) * width,
    y: height - ((value - min) / range) * height
  }));
}

function toPolyline(points: Point[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

export default function PriceChart({ prediction }: { prediction: PredictionResult }) {
  const historyPoints = toPoints(prediction.history);
  const forecastSeries = [prediction.history[prediction.history.length - 1], ...prediction.forecast];
  const forecastPoints = toPoints(forecastSeries).map((point) => ({
    x: point.x + 220,
    y: point.y
  }));

  return (
    <section className="card">
      <h3>Price Trend</h3>
      <svg viewBox="0 0 560 140" width="100%" style={{ marginTop: "0.75rem", overflow: "visible" }}>
        <polyline fill="none" stroke="#228be6" strokeWidth="3" points={toPolyline(historyPoints)} />
        <polyline fill="none" stroke="#12b886" strokeWidth="3" strokeDasharray="6 6" points={toPolyline(forecastPoints)} />
      </svg>
      <p className="text-muted" style={{ margin: 0 }}>
        Current: ${prediction.currentPrice.toFixed(2)} | Predicted: ${prediction.predictedPrice.toFixed(2)} (
        {prediction.predictedReturnPct.toFixed(2)}%)
      </p>
      <p className="text-muted" style={{ margin: "0.2rem 0 0" }}>
        Source: {prediction.priceSource ?? "unknown"}
        {typeof prediction.livePrice === "number" && <> | Live price: ${prediction.livePrice.toFixed(2)}</>}
        {typeof prediction.previousClose === "number" && <> | Previous close: ${prediction.previousClose.toFixed(2)}</>}
      </p>
      {prediction.priceAsOf && (
        <p className="text-muted" style={{ margin: "0.2rem 0 0" }}>
          As of: {new Date(prediction.priceAsOf).toLocaleString()} ({prediction.marketState ?? "unknown"})
        </p>
      )}
    </section>
  );
}
