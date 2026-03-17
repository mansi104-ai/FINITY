"use client";

import type { SentimentResult } from "../types";

function styleForSentiment(label: SentimentResult["label"]): { bg: string; text: string } {
  if (label === "bullish") {
    return { bg: "#e6fcf5", text: "#087f5b" };
  }

  if (label === "bearish") {
    return { bg: "#fff5f5", text: "#c92a2a" };
  }

  return { bg: "#fff9db", text: "#e67700" };
}

export default function SentimentBadge({ sentiment }: { sentiment: SentimentResult }) {
  const styles = styleForSentiment(sentiment.label);

  return (
    <span className="badge" style={{ background: styles.bg, color: styles.text }}>
      {sentiment.label.toUpperCase()} {Math.round(sentiment.confidence * 100)}%
    </span>
  );
}
