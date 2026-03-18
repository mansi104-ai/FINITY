"use client";

import type { SentimentResult, SentimentLevel } from "../types";

function styleForSentiment(level: SentimentLevel): { bg: string; text: string; label: string } {
  const styles: Record<SentimentLevel, { bg: string; text: string; label: string }> = {
    STRONG_BUY: { bg: "rgba(86, 211, 100, 0.18)", text: "#7dff9b", label: "Strong Buy" },
    BUY: { bg: "rgba(0, 214, 201, 0.16)", text: "#7af7ef", label: "Buy" },
    HOLD: { bg: "rgba(245, 184, 61, 0.16)", text: "#ffd57a", label: "Hold" },
    SELL: { bg: "rgba(255, 154, 76, 0.16)", text: "#ffb56d", label: "Sell" },
    STRONG_SELL: { bg: "rgba(255, 107, 107, 0.16)", text: "#ff9f9f", label: "Strong Sell" },
  };

  return styles[level];
}

export default function SentimentBadge({ sentiment }: { sentiment: SentimentResult }) {
  const styles = styleForSentiment(sentiment.level);

  return (
    <span className="badge" style={{ background: styles.bg, color: styles.text }}>
      {styles.label} {Math.round(sentiment.confidence * 100)}%
    </span>
  );
}
