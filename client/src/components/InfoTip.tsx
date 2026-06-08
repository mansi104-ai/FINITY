"use client";

import { useEffect, useRef, useState } from "react";

// Plain-language definitions for the important keywords shown across the app.
export const GLOSSARY: Record<string, string> = {
  marketCap: "Market capitalisation = share price × shares outstanding. The total market value of the company.",
  peRatio: "Price-to-Earnings (TTM): price ÷ earnings per share over the last 12 months. Higher = pricier vs. earnings.",
  forwardPE: "Forward P/E uses analysts' expected next-year earnings instead of trailing earnings.",
  eps: "Earnings Per Share: company profit divided by shares outstanding.",
  dividendYield: "Annual dividend as a % of the share price — the income a share pays you each year.",
  beta: "Volatility vs. the market. Beta > 1 swings more than the market; < 1 swings less.",
  priceToBook: "Price-to-Book: market value ÷ book (accounting) value. Below 1 can signal undervaluation.",
  ma50: "50-day moving average — the average closing price over the last 50 sessions (short-term trend).",
  ma200: "200-day moving average — the average over 200 sessions (long-term trend).",
  high52w: "The highest price over the last 52 weeks.",
  low52w: "The lowest price over the last 52 weeks.",
  volume: "Number of shares traded. High volume = stronger conviction behind a move.",
  rsi: "Relative Strength Index (0–100): >70 often overbought, <30 often oversold.",
  macd: "Moving Average Convergence Divergence: momentum from the gap between fast/slow EMAs and a signal line.",
  bollinger: "Bollinger Bands: a 20-day average ±2 standard deviations — price near the bands hints at stretched moves.",
  sma: "Simple Moving Average — the unweighted mean price over N sessions.",
  riskProfile: "Your risk tolerance. It scales how aggressively suggestions size positions: Low = cautious, High = aggressive.",
  regime: "Market regime: risk-on (broad buying), risk-off (broad selling), or neutral — gauged from market breadth.",
  dividend: "A share of profits paid to shareholders, usually quarterly.",
};

export default function InfoTip({ term, text }: { term?: keyof typeof GLOSSARY | string; text?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const explanation = text ?? (term ? GLOSSARY[term] : "") ?? "";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!explanation) return null;

  return (
    <span className="infotip" ref={ref}>
      <button
        type="button"
        className="infotip-btn"
        aria-label="More info"
        aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        onMouseEnter={() => setOpen(true)}
      >i</button>
      {open && <span className="infotip-panel" role="tooltip">{explanation}</span>}
    </span>
  );
}
