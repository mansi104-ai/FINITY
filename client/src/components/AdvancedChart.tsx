"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getCandles } from "../services/api";
import InfoTip from "./InfoTip";
import type { Candle } from "../types";

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Indicator math (all client-side, pure functions) ──────────────────────────
function sma(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

function ema(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    if (prev === null) {
      // seed with SMA of the first `period` values
      let seed = 0;
      for (let j = i - period + 1; j <= i; j++) seed += values[j];
      prev = seed / period;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out.push(prev);
  }
  return out;
}

function rsi(closes: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff; else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const g = diff >= 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = closes.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? (emaFast[i] as number) - (emaSlow[i] as number) : null
  );
  const defined = macdLine.map((v) => v ?? 0);
  const sig = ema(defined, signal).map((v, i) => (macdLine[i] == null ? null : v));
  const hist = macdLine.map((v, i) => (v != null && sig[i] != null ? v - (sig[i] as number) : null));
  return { macdLine, signal: sig, hist };
}

function bollinger(closes: number[], period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper: Array<number | null> = [];
  const lower: Array<number | null> = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { upper.push(null); lower.push(null); continue; }
    let sum = 0;
    const m = mid[i] as number;
    for (let j = i - period + 1; j <= i; j++) sum += (closes[j] - m) ** 2;
    const sd = Math.sqrt(sum / period);
    upper.push(m + mult * sd);
    lower.push(m - mult * sd);
  }
  return { mid, upper, lower };
}

// ─── Scaling helpers ────────────────────────────────────────────────────────────
type Indicator = "bbands" | "sma";
type Pane = "rsi" | "macd" | "none";

const RANGES = [
  { key: "1mo", label: "1M" },
  { key: "3mo", label: "3M" },
  { key: "6mo", label: "6M" },
  { key: "1y", label: "1Y" },
  { key: "2y", label: "2Y" },
];

export default function AdvancedChart({ ticker }: { ticker: string }) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [range, setRange] = useState("6mo");
  const [overlay, setOverlay] = useState<Indicator>("bbands");
  const [pane, setPane] = useState<Pane>("rsi");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setHover(null);
    getCandles(ticker, range)
      .then((res) => { if (active) { setCandles(res.candles); setLoading(false); } })
      .catch((e: unknown) => {
        if (active) { setError(e instanceof Error ? e.message : "Chart unavailable"); setLoading(false); }
      });
    return () => { active = false; };
  }, [ticker, range]);

  const closes = useMemo(() => candles.map((c) => c.close), [candles]);
  const sma20 = useMemo(() => sma(closes, 20), [closes]);
  const sma50 = useMemo(() => sma(closes, 50), [closes]);
  const bb = useMemo(() => bollinger(closes, 20, 2), [closes]);
  const rsiVals = useMemo(() => rsi(closes, 14), [closes]);
  const macdVals = useMemo(() => macd(closes), [closes]);

  if (loading) return <article className="findec-panel stk-chart-panel"><p className="findec-kicker">Loading chart…</p></article>;
  if (error || candles.length < 10) {
    return (
      <article className="findec-panel stk-chart-panel">
        <p className="findec-kicker">Advanced Chart</p>
        <p className="text-muted">{error || "Not enough data to render the advanced chart."}</p>
      </article>
    );
  }

  // ── Price pane geometry ──
  const W = 820, H = 280, padR = 46, padL = 4, plotW = W - padR - padL;
  const lows = candles.map((c) => c.low);
  const highs = candles.map((c) => c.high);
  let yMin = Math.min(...lows);
  let yMax = Math.max(...highs);
  if (overlay === "bbands") {
    const lo = bb.lower.filter((v): v is number => v != null);
    const hi = bb.upper.filter((v): v is number => v != null);
    if (lo.length) yMin = Math.min(yMin, ...lo);
    if (hi.length) yMax = Math.max(yMax, ...hi);
  }
  const yRange = Math.max(yMax - yMin, 0.01);
  const xOf = (i: number) => padL + (i / Math.max(candles.length - 1, 1)) * plotW;
  const yOf = (v: number) => H - ((v - yMin) / yRange) * H;
  const candleW = Math.max(1, Math.min(8, (plotW / candles.length) * 0.7));

  const line = (vals: Array<number | null>) =>
    vals.map((v, i) => (v == null ? null : `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`))
      .filter(Boolean).join(" ");

  const priceMarks = Array.from({ length: 5 }, (_, i) => yMax - (yRange / 4) * i);

  // Hover/touch crosshair → OHLC readout for the candle under the pointer.
  const activeIdx = hover != null ? hover : candles.length - 1;
  const active = candles[activeIdx];
  const activeUp = active.close >= active.open;

  function handlePointer(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const relX = ((e.clientX - rect.left) / rect.width) * W; // client px → viewBox units
    const i = Math.round(((relX - padL) / plotW) * (candles.length - 1));
    setHover(Math.max(0, Math.min(candles.length - 1, i)));
  }

  return (
    <article className="findec-panel stk-chart-panel">
      <div className="stk-chart-top">
        <p className="findec-kicker">Advanced Chart · {ticker}</p>
        <div className="adv-chart-controls">
          {RANGES.map((r) => (
            <button
              key={r.key}
              className={`adv-chip ${range === r.key ? "adv-chip-on" : ""}`}
              onClick={() => setRange(r.key)}
            >{r.label}</button>
          ))}
        </div>
      </div>

      <div className="adv-chart-toggles">
        <div className="adv-toggle-group">
          <span className="adv-toggle-label">Overlay <InfoTip term={overlay === "sma" ? "sma" : "bollinger"} /></span>
          <button className={`adv-chip ${overlay === "bbands" ? "adv-chip-on" : ""}`} onClick={() => setOverlay("bbands")}>Bollinger</button>
          <button className={`adv-chip ${overlay === "sma" ? "adv-chip-on" : ""}`} onClick={() => setOverlay("sma")}>SMA 20/50</button>
        </div>
        <div className="adv-toggle-group">
          <span className="adv-toggle-label">Indicator <InfoTip term={pane === "macd" ? "macd" : "rsi"} /></span>
          <button className={`adv-chip ${pane === "rsi" ? "adv-chip-on" : ""}`} onClick={() => setPane("rsi")}>RSI</button>
          <button className={`adv-chip ${pane === "macd" ? "adv-chip-on" : ""}`} onClick={() => setPane("macd")}>MACD</button>
          <button className={`adv-chip ${pane === "none" ? "adv-chip-on" : ""}`} onClick={() => setPane("none")}>None</button>
        </div>
      </div>

      {/* ── OHLC readout (updates on hover/touch; defaults to latest) ── */}
      <div className="adv-readout">
        <span className="adv-readout-date">{fmtDay(active.date)}{hover == null ? " · latest" : ""}</span>
        <span>O <strong>{active.open.toFixed(2)}</strong></span>
        <span>H <strong className="findec-subline-up">{active.high.toFixed(2)}</strong></span>
        <span>L <strong className="findec-subline-down">{active.low.toFixed(2)}</strong></span>
        <span>C <strong className={activeUp ? "findec-subline-up" : "findec-subline-down"}>{active.close.toFixed(2)}</strong></span>
        <span className="adv-readout-vol">Vol {active.volume >= 1e6 ? `${(active.volume / 1e6).toFixed(1)}M` : active.volume.toLocaleString()}</span>
      </div>

      {/* ── Price + candlesticks ── */}
      <div className="stk-chart-svg-wrap">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H + 16}`}
          width="100%"
          aria-label="Advanced candlestick chart"
          className="adv-interactive"
          onPointerMove={handlePointer}
          onPointerDown={handlePointer}
          onPointerLeave={() => setHover(null)}
        >
          {priceMarks.map((m, idx) => {
            const y = (H / 4) * idx;
            return (
              <g key={m}>
                <line x1={padL} y1={y} x2={padL + plotW} y2={y} className="findec-chart-grid" />
                <text x={padL + plotW + 4} y={y + 3} className="adv-axis-text">{m.toFixed(2)}</text>
              </g>
            );
          })}

          {/* Bollinger band fill */}
          {overlay === "bbands" && (
            <>
              <polyline fill="none" stroke="#9aa6c2" strokeWidth="1" strokeDasharray="3 3" points={line(bb.upper)} />
              <polyline fill="none" stroke="#9aa6c2" strokeWidth="1" strokeDasharray="3 3" points={line(bb.lower)} />
              <polyline fill="none" stroke="#246bff" strokeWidth="1.2" points={line(bb.mid)} />
            </>
          )}
          {overlay === "sma" && (
            <>
              <polyline fill="none" stroke="#e0a32e" strokeWidth="1.5" points={line(sma20)} />
              <polyline fill="none" stroke="#246bff" strokeWidth="1.5" points={line(sma50)} />
            </>
          )}

          {/* Candlesticks */}
          {candles.map((c, i) => {
            const up = c.close >= c.open;
            const color = up ? "#33b36b" : "#cc5147";
            const x = xOf(i);
            const yHigh = yOf(c.high);
            const yLow = yOf(c.low);
            const yOpen = yOf(c.open);
            const yClose = yOf(c.close);
            const bodyTop = Math.min(yOpen, yClose);
            const bodyH = Math.max(1, Math.abs(yClose - yOpen));
            return (
              <g key={i}>
                <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={color} strokeWidth="1" />
                <rect x={x - candleW / 2} y={bodyTop} width={candleW} height={bodyH} fill={color} />
              </g>
            );
          })}

          {/* Crosshair at the hovered candle */}
          {hover != null && (
            <g pointerEvents="none">
              <line x1={xOf(hover)} y1={0} x2={xOf(hover)} y2={H} stroke="#cdd6e6" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.6" />
              <line x1={padL} y1={yOf(active.close)} x2={padL + plotW} y2={yOf(active.close)} stroke="#cdd6e6" strokeWidth="0.6" strokeDasharray="2 3" opacity="0.4" />
              <circle cx={xOf(hover)} cy={yOf(active.close)} r="3" fill="#f4efe6" />
            </g>
          )}
        </svg>
      </div>

      {overlay === "sma" && (
        <div className="adv-legend">
          <span><i className="adv-swatch" style={{ background: "#e0a32e" }} /> SMA 20</span>
          <span><i className="adv-swatch" style={{ background: "#246bff" }} /> SMA 50</span>
        </div>
      )}
      {overlay === "bbands" && (
        <div className="adv-legend">
          <span><i className="adv-swatch" style={{ background: "#246bff" }} /> SMA 20 (mid)</span>
          <span><i className="adv-swatch" style={{ background: "#9aa6c2" }} /> ±2σ bands</span>
        </div>
      )}

      {/* ── RSI pane ── */}
      {pane === "rsi" && <RsiPane rsiVals={rsiVals} xOf={xOf} plotW={plotW} padL={padL} padR={padR} />}
      {/* ── MACD pane ── */}
      {pane === "macd" && <MacdPane macdVals={macdVals} xOf={xOf} candleW={candleW} plotW={plotW} padL={padL} padR={padR} />}
    </article>
  );
}

function RsiPane({ rsiVals, xOf, plotW, padL, padR }: {
  rsiVals: Array<number | null>; xOf: (i: number) => number; plotW: number; padL: number; padR: number;
}) {
  const W = plotW + padL + padR, H = 90;
  const yOf = (v: number) => H - (v / 100) * H;
  const pts = rsiVals.map((v, i) => (v == null ? null : `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`)).filter(Boolean).join(" ");
  const last = [...rsiVals].reverse().find((v) => v != null) ?? null;
  return (
    <div className="adv-subpane">
      <div className="adv-subpane-head">
        <span className="findec-kicker">RSI (14)</span>
        {last != null && (
          <strong className={last >= 70 ? "findec-subline-down" : last <= 30 ? "findec-subline-up" : ""}>
            {last.toFixed(1)}{last >= 70 ? " · overbought" : last <= 30 ? " · oversold" : ""}
          </strong>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" aria-label="RSI indicator">
        <line x1={padL} y1={yOf(70)} x2={padL + plotW} y2={yOf(70)} stroke="#cc5147" strokeWidth="0.8" strokeDasharray="3 3" />
        <line x1={padL} y1={yOf(30)} x2={padL + plotW} y2={yOf(30)} stroke="#33b36b" strokeWidth="0.8" strokeDasharray="3 3" />
        <line x1={padL} y1={yOf(50)} x2={padL + plotW} y2={yOf(50)} className="findec-chart-grid" />
        <text x={padL + plotW + 4} y={yOf(70) + 3} className="adv-axis-text">70</text>
        <text x={padL + plotW + 4} y={yOf(30) + 3} className="adv-axis-text">30</text>
        <polyline fill="none" stroke="#7b61ff" strokeWidth="1.5" points={pts} />
      </svg>
    </div>
  );
}

function MacdPane({ macdVals, xOf, candleW, plotW, padL, padR }: {
  macdVals: ReturnType<typeof macd>; xOf: (i: number) => number; candleW: number; plotW: number; padL: number; padR: number;
}) {
  const W = plotW + padL + padR, H = 90;
  const all = [...macdVals.macdLine, ...macdVals.signal, ...macdVals.hist].filter((v): v is number => v != null);
  const max = Math.max(0.001, ...all.map(Math.abs));
  const yOf = (v: number) => H / 2 - (v / max) * (H / 2 - 4);
  const lineStr = (vals: Array<number | null>) =>
    vals.map((v, i) => (v == null ? null : `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`)).filter(Boolean).join(" ");
  return (
    <div className="adv-subpane">
      <div className="adv-subpane-head">
        <span className="findec-kicker">MACD (12, 26, 9)</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" aria-label="MACD indicator">
        <line x1={padL} y1={H / 2} x2={padL + plotW} y2={H / 2} className="findec-chart-grid" />
        {macdVals.hist.map((v, i) =>
          v == null ? null : (
            <rect
              key={i}
              x={xOf(i) - candleW / 2}
              y={Math.min(H / 2, yOf(v))}
              width={candleW}
              height={Math.max(0.5, Math.abs(yOf(v) - H / 2))}
              fill={v >= 0 ? "rgba(51,179,107,0.6)" : "rgba(204,81,71,0.6)"}
            />
          )
        )}
        <polyline fill="none" stroke="#246bff" strokeWidth="1.4" points={lineStr(macdVals.macdLine)} />
        <polyline fill="none" stroke="#e0a32e" strokeWidth="1.4" points={lineStr(macdVals.signal)} />
      </svg>
      <div className="adv-legend">
        <span><i className="adv-swatch" style={{ background: "#246bff" }} /> MACD</span>
        <span><i className="adv-swatch" style={{ background: "#e0a32e" }} /> Signal</span>
        <span><i className="adv-swatch" style={{ background: "rgba(51,179,107,0.6)" }} /> Histogram</span>
      </div>
    </div>
  );
}
