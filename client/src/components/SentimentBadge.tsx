"use client";

import type { SentimentResult, SentimentLevel } from "../types";

function styleForSentiment(level: SentimentLevel): { bg: string; text: string } {
  // 5-level sentiment color scheme
  const styles: Record<SentimentLevel, { bg: string; text: string }> = {
    STRONG_BUY: { bg: "#c3e6cb", text: "#155724" },     // Dark green
    BUY: { bg: "#e6fcf5", text: "#087f5b" },            // Light green
    HOLD: { bg: "#fff9db", text: "#e67700" },           // Yellow/Orange
    SELL: { bg: "#f8d7da", text: "#721c24" },           // Light red
    STRONG_SELL: { bg: "#f5c6cb", text: "#721c24" },    // Dark red
  };
  
  return styles[level] || { bg: "#fff9db", text: "#e67700" };
}

export default function SentimentBadge({ sentiment }: { sentiment: SentimentResult }) {
  const styles = styleForSentiment(sentiment.level);
  
  const levelDisplay: Record<SentimentLevel, string> = {
    STRONG_BUY: "🚀 Strong Buy",
    BUY: "📈 Buy",
    HOLD: "➡️ Hold",
    SELL: "📉 Sell",
    STRONG_SELL: "⛔ Strong Sell",
  };

  return (
    <span className="badge" style={{ background: styles.bg, color: styles.text }}>
      {levelDisplay[sentiment.level]} {Math.round(sentiment.confidence * 100)}%
    </span>
  );
}
