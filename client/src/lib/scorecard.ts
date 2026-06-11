import type { StockQuote } from "../types";

// ── Findec Scorecard: a 0-100 multi-factor read computed from fundamentals,
//    comparable to Tickertape's Scorecard / Trendlyne's DVM score. ──
export type ScoreDim = { key: string; label: string; score: number; note: string };

function clamp(n: number): number { return Math.max(0, Math.min(100, Math.round(n))); }

export function scoreValuation(s: StockQuote): number | null {
  if (s.peRatio == null) return null;
  const pe = s.peRatio;
  let v: number;
  if (pe <= 0) v = 28;
  else if (pe < 10) v = 92;
  else if (pe < 15) v = 84;
  else if (pe < 20) v = 74;
  else if (pe < 25) v = 64;
  else if (pe < 35) v = 50;
  else if (pe < 50) v = 36;
  else v = 22;
  if (s.priceToBook != null) {
    if (s.priceToBook < 1) v += 8;
    else if (s.priceToBook > 8) v -= 8;
  }
  return clamp(v);
}

export function scoreMomentum(s: StockQuote): number | null {
  if (s.ma50 == null && s.ma200 == null && (s.high52w == null || s.low52w == null)) return null;
  let v = 50;
  if (s.ma50 != null) v += s.price >= s.ma50 ? 14 : -12;
  if (s.ma200 != null) v += s.price >= s.ma200 ? 14 : -12;
  if (s.ma50 != null && s.ma200 != null) v += s.ma50 >= s.ma200 ? 8 : -8;
  if (s.high52w != null && s.low52w != null && s.high52w > s.low52w) {
    const pos = ((s.price - s.low52w) / (s.high52w - s.low52w)) * 100;
    if (pos >= 40 && pos <= 88) v += 8;
    else if (pos > 88) v += 3;
    else if (pos < 20) v -= 8;
  }
  return clamp(v);
}

export function scoreStability(s: StockQuote): number | null {
  if (s.beta == null) return null;
  const b = s.beta;
  if (b < 0.7) return 90;
  if (b < 1.0) return 76;
  if (b < 1.3) return 60;
  if (b < 1.7) return 44;
  return 30;
}

export function scoreIncome(s: StockQuote): number | null {
  if (s.dividendYield == null) return null;
  const y = s.dividendYield;
  if (y >= 4) return 95;
  if (y >= 2.5) return 80;
  if (y >= 1) return 60;
  if (y > 0) return 42;
  return 20;
}

export function scoreBand(n: number): { label: string; cls: string } {
  if (n >= 75) return { label: "Strong", cls: "sc-strong" };
  if (n >= 60) return { label: "Good", cls: "sc-good" };
  if (n >= 45) return { label: "Average", cls: "sc-avg" };
  return { label: "Weak", cls: "sc-weak" };
}

export function buildScorecard(s: StockQuote): { overall: number; dims: ScoreDim[] } | null {
  const raw = [
    { key: "val", label: "Valuation", score: scoreValuation(s), weight: 0.3, note: (n: number) => n >= 70 ? "Attractively priced" : n >= 50 ? "Fairly valued" : "Richly valued" },
    { key: "mom", label: "Momentum", score: scoreMomentum(s), weight: 0.3, note: (n: number) => n >= 70 ? "Trending up" : n >= 50 ? "Neutral trend" : "Under pressure" },
    { key: "stab", label: "Stability", score: scoreStability(s), weight: 0.2, note: (n: number) => n >= 70 ? "Low volatility" : n >= 50 ? "Market-like risk" : "High volatility" },
    { key: "inc", label: "Income", score: scoreIncome(s), weight: 0.2, note: (n: number) => n >= 70 ? "Strong dividend" : n >= 50 ? "Moderate yield" : "Low / no yield" },
  ];
  const present = raw.filter((d): d is typeof d & { score: number } => d.score != null);
  if (present.length < 2) return null;
  const wsum = present.reduce((a, d) => a + d.weight, 0);
  const overall = clamp(present.reduce((a, d) => a + d.score * d.weight, 0) / wsum);
  const dims = present.map((d) => ({ key: d.key, label: d.label, score: d.score, note: d.note(d.score) }));
  return { overall, dims };
}
