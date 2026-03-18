"use client";

import type { SentimentResult, SentimentLevel } from "../types";

function styleForSentiment(level: SentimentLevel): { bg: string; text: string; label: string } {
  const styles: Record<SentimentLevel, { bg: string; text: string; label: string }> = {
    STRONG_BUY: { bg: "rgba(51, 179, 107, 0.14)", text: "#207f4b", label: "Strong Buy" },
    BUY: { bg: "rgba(36, 107, 255, 0.12)", text: "#194ec4", label: "Buy" },
    HOLD: { bg: "rgba(242, 179, 39, 0.16)", text: "#9a6901", label: "Hold" },
    SELL: { bg: "rgba(255, 177, 115, 0.18)", text: "#b56115", label: "Sell" },
    STRONG_SELL: { bg: "rgba(230, 97, 84, 0.14)", text: "#a33f35", label: "Strong Sell" },
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
