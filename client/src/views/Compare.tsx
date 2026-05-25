"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getMarketHistory, getStockDetail } from "../services/api";
import type { MarketHistory, StockQuote } from "../types";

const PALETTE = ["#4f8ef7", "#f2b327", "#72b92b", "#cc5147"];
const MAX_TICKERS = 4;

function fmtNum(v: number, d = 2): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
}

function fmtCap(v: number): string {
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  return v.toLocaleString();
}

function normalise(points: number[]): number[] {
  const base = points[0];
  if (!base) return points;
  return points.map((p) => ((p - base) / base) * 100);
}

function buildPolyline(normPts: number[], w: number, h: number): string {
  if (!normPts.length) return "";
  const min = Math.min(...normPts);
  const max = Math.max(...normPts);
  const range = Math.max(max - min, 0.1);
  return normPts
    .map((v, i) => {
      const x = (i / Math.max(normPts.length - 1, 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

interface LoadedTicker {
  ticker: string;
  quote: StockQuote | null;
  history: MarketHistory | null;
  error: string | null;
}

export default function Compare() {
  const params = useSearchParams();
  const initialTickers = useMemo(() => {
    const raw = params.get("tickers") ?? "";
    return raw ? raw.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean).slice(0, MAX_TICKERS) : [];
  }, [params]);

  const [tickers, setTickers] = useState<string[]>(initialTickers);
  const [data, setData] = useState<LoadedTicker[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const loadedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const toLoad = tickers.filter((t) => !loadedRef.current.has(t));
    if (!toLoad.length) return;
    setLoading(true);
    void Promise.all(
      toLoad.map(async (ticker): Promise<LoadedTicker> => {
        try {
          const [quote, history] = await Promise.all([
            getStockDetail(ticker),
            getMarketHistory(ticker),
          ]);
          loadedRef.current.add(ticker);
          return { ticker, quote, history, error: null };
        } catch (e) {
          loadedRef.current.add(ticker);
          return { ticker, quote: null, history: null, error: e instanceof Error ? e.message : "Failed" };
        }
      })
    ).then((results) => {
      setData((prev) => {
        const map = new Map(prev.map((d) => [d.ticker, d]));
        results.forEach((r) => map.set(r.ticker, r));
        return tickers.map((t) => map.get(t)).filter(Boolean) as LoadedTicker[];
      });
      setLoading(false);
    });
  }, [tickers]);

  function addTicker() {
    const t = input.trim().toUpperCase();
    if (!t || tickers.includes(t) || tickers.length >= MAX_TICKERS) return;
    setInput("");
    setTickers((prev) => [...prev, t]);
  }

  function removeTicker(t: string) {
    loadedRef.current.delete(t);
    setTickers((prev) => prev.filter((x) => x !== t));
    setData((prev) => prev.filter((d) => d.ticker !== t));
  }

  const chartData = useMemo(() => {
    return data
      .filter((d) => d.history && d.history.points.length > 0)
      .map((d, i) => ({
        ticker: d.ticker,
        color: PALETTE[i % PALETTE.length],
        pts: normalise(d.history!.points.map((p) => p.close)),
      }));
  }, [data]);

  const hasChart = chartData.length > 0;

  const METRICS: Array<{ label: string; key: keyof StockQuote; fmt: (v: number) => string }> = [
    { label: "Price", key: "price", fmt: fmtNum },
    { label: "Day Change %", key: "changePercent", fmt: (v) => `${v >= 0 ? "+" : ""}${fmtNum(v)}%` },
    { label: "Market Cap", key: "marketCap", fmt: fmtCap },
    { label: "P/E (TTM)", key: "peRatio", fmt: (v) => fmtNum(v, 1) },
    { label: "Forward P/E", key: "forwardPE", fmt: (v) => fmtNum(v, 1) },
    { label: "EPS (TTM)", key: "eps", fmt: fmtNum },
    { label: "Dividend Yield", key: "dividendYield", fmt: (v) => `${fmtNum(v, 2)}%` },
    { label: "52W High", key: "high52w", fmt: fmtNum },
    { label: "52W Low", key: "low52w", fmt: fmtNum },
    { label: "MA 50", key: "ma50", fmt: fmtNum },
    { label: "MA 200", key: "ma200", fmt: fmtNum },
    { label: "Beta", key: "beta", fmt: (v) => fmtNum(v, 2) },
    { label: "P/B Ratio", key: "priceToBook", fmt: (v) => fmtNum(v, 2) },
  ];

  return (
    <section className="findec-minimal-page">
      <div className="findec-minimal-shell cmp-shell">
        <div className="cmp-header-row">
          <div>
            <p className="findec-kicker">Side-by-side analysis</p>
            <h1 className="cmp-title">Compare Stocks</h1>
          </div>
          <Link href="/screener" className="cmp-nav-btn">Screener →</Link>
        </div>

        {/* Add ticker */}
        <div className="findec-panel cmp-add-panel">
          <div className="cmp-chips-row">
            {tickers.map((t, i) => (
              <div key={t} className="cmp-chip" style={{ borderColor: PALETTE[i % PALETTE.length] }}>
                <span>{t}</span>
                <button className="cmp-chip-remove" onClick={() => removeTicker(t)}>×</button>
              </div>
            ))}
            {tickers.length < MAX_TICKERS && (
              <div className="cmp-add-row">
                <input
                  className="cmp-input"
                  placeholder="Add ticker…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addTicker(); }}
                />
                <button className="cmp-add-btn" onClick={addTicker} disabled={!input.trim()}>+</button>
              </div>
            )}
          </div>
          {tickers.length === 0 && (
            <p className="cmp-hint">Enter 2–4 ticker symbols to compare them side by side.</p>
          )}
          {loading && <p className="findec-kicker cmp-loading">Loading data…</p>}
        </div>

        {/* Normalised price chart */}
        {hasChart && (
          <div className="findec-panel cmp-chart-panel">
            <div className="cmp-chart-top">
              <p className="findec-kicker">30-Day Normalised Return (%)</p>
              <div className="cmp-legend">
                {chartData.map((d) => (
                  <div key={d.ticker} className="cmp-legend-item">
                    <span className="cmp-legend-dot" style={{ background: d.color }} />
                    <span>{d.ticker}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="cmp-chart-svg-wrap">
              <svg viewBox="0 0 760 120" width="100%" aria-label="Comparison chart">
                {[30, 60, 90].map((y) => (
                  <line key={y} x1="0" y1={y} x2="760" y2={y} className="findec-chart-grid" />
                ))}
                {chartData.map((d) => (
                  <polyline
                    key={d.ticker}
                    fill="none"
                    stroke={d.color}
                    strokeWidth="2"
                    points={buildPolyline(d.pts, 760, 120)}
                  />
                ))}
              </svg>
            </div>
          </div>
        )}

        {/* Metrics table */}
        {data.length > 0 && (
          <div className="findec-panel cmp-table-wrap">
            <p className="findec-kicker cmp-table-kicker">Metrics Comparison</p>
            <table className="cmp-table">
              <thead>
                <tr>
                  <th className="cmp-th cmp-th-metric">Metric</th>
                  {data.map((d, i) => (
                    <th key={d.ticker} className="cmp-th cmp-th-val" style={{ color: PALETTE[i % PALETTE.length] }}>
                      <Link href={`/stock/${encodeURIComponent(d.ticker)}`}>{d.ticker}</Link>
                      {d.quote && <span className="cmp-th-name">{d.quote.name}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRICS.map(({ label, key, fmt }) => {
                  const vals = data.map((d) => (d.quote ? (d.quote[key] as number | undefined) : undefined));
                  const numVals = vals.filter((v): v is number => typeof v === "number");
                  const best = numVals.length > 1 ? Math.max(...numVals) : null;

                  return (
                    <tr key={label} className="cmp-row">
                      <td className="cmp-td cmp-td-metric">{label}</td>
                      {data.map((d, i) => {
                        const v = d.quote ? (d.quote[key] as number | undefined) : undefined;
                        const isBest = best !== null && v === best;
                        return (
                          <td key={d.ticker} className={`cmp-td cmp-td-val ${isBest ? "cmp-best" : ""}`}>
                            {d.error ? (
                              <span className="cmp-err">Error</span>
                            ) : v != null ? (
                              <span style={{ color: key === "changePercent" ? (v >= 0 ? "#72b92b" : "#cc5147") : undefined }}>
                                {fmt(v)}
                              </span>
                            ) : (
                              <span className="cmp-dim">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* CTA row */}
        {data.length > 0 && (
          <div className="cmp-cta-row">
            {data.map((d) => (
              <Link key={d.ticker} href={`/brief?ticker=${encodeURIComponent(d.ticker)}`} className="cmp-cta-btn">
                AI Brief · {d.ticker}
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
