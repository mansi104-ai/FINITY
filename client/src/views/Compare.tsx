"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getMarketHistory, getStockDetail } from "../services/api";
import type { MarketHistory, StockQuote } from "../types";
import { buildScorecard } from "../lib/scorecard";

const PALETTE = ["#4f8ef7", "#f2b327", "#72b92b", "#cc5147"];
const MAX_TICKERS = 4;
const CUSTOM_GROUPS_KEY = "findec-compare-groups";

type Group = { label: string; tickers: string[] };

const POPULAR_PAIRS: Group[] = [
  { label: "Tech Giants", tickers: ["AAPL", "MSFT", "GOOGL"] },
  { label: "AI Race", tickers: ["NVDA", "MSFT", "GOOGL"] },
  { label: "EV vs ICE", tickers: ["TSLA", "F", "GM"] },
  { label: "Big Banks", tickers: ["JPM", "BAC", "GS"] },
  { label: "FAANG", tickers: ["META", "AMZN", "AAPL", "NVDA"] },
];

function loadCustomGroups(): Group[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_GROUPS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Group[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

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
      const y = h - ((v - min) / range) * (h - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

interface LoadedTicker {
  ticker: string;
  quote: StockQuote | null;
  history: MarketHistory | null;
  error: string | null;
  errorKind: "network" | "not-found" | null;
}

function classifyLoadError(error: unknown): { message: string; kind: "network" | "not-found" } {
  const message = error instanceof Error ? error.message : "Data unavailable";
  if (/not found|could not find data|check the ticker symbol/i.test(message)) {
    return { message, kind: "not-found" };
  }
  return { message, kind: "network" };
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
  const [inputError, setInputError] = useState("");
  const [loading, setLoading] = useState(false);
  const [customGroups, setCustomGroups] = useState<Group[]>([]);
  const loadedRef = useRef<Set<string>>(new Set());

  useEffect(() => { setCustomGroups(loadCustomGroups()); }, []);

  function saveCurrentGroup() {
    if (tickers.length < 2) return;
    const name = (typeof window !== "undefined" ? window.prompt("Name this comparison group:", tickers.join(", ")) : "")?.trim();
    if (!name) return;
    const next = [...customGroups.filter((g) => g.label !== name), { label: name, tickers: [...tickers] }];
    setCustomGroups(next);
    if (typeof window !== "undefined") window.localStorage.setItem(CUSTOM_GROUPS_KEY, JSON.stringify(next));
  }

  function deleteGroup(label: string) {
    const next = customGroups.filter((g) => g.label !== label);
    setCustomGroups(next);
    if (typeof window !== "undefined") window.localStorage.setItem(CUSTOM_GROUPS_KEY, JSON.stringify(next));
  }

  useEffect(() => {
    const toLoad = tickers.filter((t) => !loadedRef.current.has(t));
    if (!toLoad.length) return;

    setLoading(true);
    void Promise.all(
      toLoad.map(async (ticker): Promise<LoadedTicker> => {
        const [quoteResult, historyResult] = await Promise.allSettled([
          getStockDetail(ticker),
          getMarketHistory(ticker),
        ]);

        loadedRef.current.add(ticker);

        const quote = quoteResult.status === "fulfilled" ? quoteResult.value : null;
        const history = historyResult.status === "fulfilled" ? historyResult.value : null;
        const quoteError = quoteResult.status === "rejected" ? classifyLoadError(quoteResult.reason) : null;
        const historyError = historyResult.status === "rejected" ? classifyLoadError(historyResult.reason) : null;
        const errors = [quoteError?.message, historyError?.message].filter(Boolean);
        const errorKind =
          quoteError?.kind === "not-found" || historyError?.kind === "not-found"
            ? "not-found"
            : quoteError?.kind === "network" || historyError?.kind === "network"
              ? "network"
              : null;

        return {
          ticker,
          quote,
          history,
          error: errors.length > 0 ? errors.join(" | ") : null,
          errorKind,
        };
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
    setInputError("");
    if (!t) return;
    if (tickers.includes(t)) {
      setInputError(`${t} is already added.`);
      return;
    }
    if (tickers.length >= MAX_TICKERS) {
      setInputError(`Max ${MAX_TICKERS} tickers.`);
      return;
    }
    setInput("");
    setTickers((prev) => [...prev, t]);
  }

  function removeTicker(t: string) {
    loadedRef.current.delete(t);
    setTickers((prev) => prev.filter((x) => x !== t));
    setData((prev) => prev.filter((d) => d.ticker !== t));
  }

  function loadPair(pair: Group) {
    loadedRef.current.clear();
    setData([]);
    setTickers(pair.tickers.slice(0, MAX_TICKERS));
  }

  const chartData = useMemo(() => {
    return data
      .filter((d) => d.history && d.history.points.length > 0)
      .map((d) => ({
        ticker: d.ticker,
        color: PALETTE[tickers.indexOf(d.ticker) % PALETTE.length],
        pts: normalise(d.history!.points.map((p) => p.close)),
        ret: d.history!.changePercent30d,
      }));
  }, [data, tickers]);

  const hasChart = chartData.length > 0;

  const METRICS: Array<{ label: string; key: keyof StockQuote; fmt: (v: number) => string; higherIsBetter?: boolean }> = [
    { label: "Price", key: "price", fmt: fmtNum },
    { label: "Day Change %", key: "changePercent", fmt: (v) => `${v >= 0 ? "+" : ""}${fmtNum(v)}%`, higherIsBetter: true },
    { label: "Market Cap", key: "marketCap", fmt: fmtCap, higherIsBetter: true },
    { label: "P/E (TTM)", key: "peRatio", fmt: (v) => fmtNum(v, 1) },
    { label: "Forward P/E", key: "forwardPE", fmt: (v) => fmtNum(v, 1) },
    { label: "EPS (TTM)", key: "eps", fmt: fmtNum, higherIsBetter: true },
    { label: "Dividend Yield", key: "dividendYield", fmt: (v) => `${fmtNum(v, 2)}%`, higherIsBetter: true },
    { label: "52W High", key: "high52w", fmt: fmtNum },
    { label: "52W Low", key: "low52w", fmt: fmtNum },
    { label: "MA 50", key: "ma50", fmt: fmtNum },
    { label: "MA 200", key: "ma200", fmt: fmtNum },
    { label: "Beta", key: "beta", fmt: (v) => fmtNum(v, 2) },
    { label: "P/B Ratio", key: "priceToBook", fmt: (v) => fmtNum(v, 2) },
  ];

  const isEmpty = tickers.length === 0;
  const availableQuotes = data.filter((d) => d.quote);

  // ── Findec verdict: a data-grounded head-to-head from the Scorecard ──
  const verdict = useMemo(() => {
    const entries = availableQuotes
      .map((d) => ({ ticker: d.ticker, name: d.quote!.name, card: buildScorecard(d.quote!) }))
      .filter((e): e is { ticker: string; name: string; card: NonNullable<ReturnType<typeof buildScorecard>> } => e.card != null)
      .sort((a, b) => b.card.overall - a.card.overall);
    if (entries.length < 2) return null;

    const win = entries[0];
    const runner = entries[1];
    const dimLabel = (k: string) => ({ val: "valuation", mom: "momentum", stab: "stability", inc: "income" }[k] ?? k);
    const winScore = (k: string) => win.card.dims.find((d) => d.key === k)?.score ?? -1;
    const runScore = (k: string) => runner.card.dims.find((d) => d.key === k)?.score ?? -1;

    const winStrengths = win.card.dims.filter((d) => d.score >= 65).sort((a, b) => b.score - a.score).map((d) => dimLabel(d.key));
    const runnerEdges = runner.card.dims
      .filter((d) => runScore(d.key) > winScore(d.key) + 4)
      .sort((a, b) => b.score - a.score)
      .map((d) => dimLabel(d.key));

    const tie = win.card.overall - runner.card.overall <= 3;
    let line: string;
    if (tie) {
      line = `${win.ticker} and ${runner.ticker} are neck-and-neck (${win.card.overall} vs ${runner.card.overall}).`;
    } else {
      line = `${win.ticker} edges out ${runner.ticker} (${win.card.overall} vs ${runner.card.overall})`;
      if (winStrengths.length) line += `, led by ${winStrengths.slice(0, 2).join(" and ")}`;
      line += ".";
    }
    if (runnerEdges.length) line += ` ${runner.ticker} still wins on ${runnerEdges.slice(0, 2).join(" and ")}.`;
    return { entries, line, winner: win.ticker };
  }, [availableQuotes]);

  return (
    <section className="findec-minimal-page">
      <div className="findec-minimal-shell cmp-shell">
        <div className="cmp-header-row">
          <div>
            <p className="findec-kicker">Side-by-side analysis</p>
            <h1 className="cmp-title">Compare Stocks</h1>
          </div>
          <Link href="/screener" className="cmp-nav-btn">Screener -&gt;</Link>
        </div>

        <div className="findec-panel cmp-add-panel">
          <p className="findec-kicker">Add up to {MAX_TICKERS} tickers</p>
          <div className="cmp-chips-row">
            {tickers.map((t, i) => (
              <div key={t} className="cmp-chip" style={{ borderColor: PALETTE[i % PALETTE.length] }}>
                <span style={{ color: PALETTE[i % PALETTE.length] }}>{t}</span>
                <button className="cmp-chip-remove" onClick={() => removeTicker(t)} title="Remove">x</button>
              </div>
            ))}
            {tickers.length < MAX_TICKERS && (
              <div className="cmp-add-row">
                <input
                  className="cmp-input"
                  placeholder="Ticker, e.g. AAPL"
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value.toUpperCase());
                    setInputError("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addTicker();
                  }}
                />
                <button className="cmp-add-btn" onClick={addTicker} disabled={!input.trim()}>+ Add</button>
              </div>
            )}
          </div>
          {inputError && <p className="cmp-input-error">{inputError}</p>}
          {loading && <p className="findec-kicker cmp-loading">Loading data...</p>}

          <div className="cmp-pairs-row">
            <span className="cmp-pairs-label">Quick compare:</span>
            {POPULAR_PAIRS.map((pair) => (
              <button key={pair.label} className="cmp-pair-btn" onClick={() => loadPair(pair)}>
                {pair.label}
              </button>
            ))}
            {customGroups.map((g) => (
              <span key={g.label} className="cmp-pair-custom">
                <button className="cmp-pair-btn cmp-pair-btn-custom" onClick={() => loadPair(g)}>{g.label}</button>
                <button className="cmp-pair-del" title="Delete group" onClick={() => deleteGroup(g.label)}>×</button>
              </span>
            ))}
            {tickers.length >= 2 && (
              <button className="cmp-pair-btn cmp-pair-save" onClick={saveCurrentGroup}>+ Save group</button>
            )}
          </div>
        </div>

        {isEmpty && (
          <div className="findec-panel cmp-empty">
            <p className="cmp-empty-title">Select stocks to compare</p>
            <p className="cmp-empty-sub">Type ticker symbols above, or pick a quick comparison preset.</p>
            <div className="cmp-empty-pairs">
              {POPULAR_PAIRS.map((pair) => (
                <button key={pair.label} className="cmp-empty-pair-btn" onClick={() => loadPair(pair)}>
                  <strong>{pair.label}</strong>
                  <span>{pair.tickers.join(" vs ")}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {hasChart && (
          <div className="findec-panel cmp-chart-panel">
            <div className="cmp-chart-top">
              <p className="findec-kicker">30-Day Normalised Return (%)</p>
              <div className="cmp-legend">
                {chartData.map((d) => (
                  <div key={d.ticker} className="cmp-legend-item">
                    <span className="cmp-legend-dot" style={{ background: d.color }} />
                    <span style={{ color: d.color }}>{d.ticker}</span>
                    <span className={d.ret >= 0 ? "findec-subline-up" : "findec-subline-down"}>
                      {d.ret >= 0 ? "+" : ""}{d.ret.toFixed(2)}%
                    </span>
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
                    strokeLinejoin="round"
                    points={buildPolyline(d.pts, 760, 120)}
                  />
                ))}
              </svg>
            </div>
          </div>
        )}

        {verdict && (
          <div className="findec-panel cmp-verdict">
            <div className="cmp-verdict-head">
              <span className="home-feature-badge">Findec Verdict</span>
              <span className="cmp-verdict-sub">Data-grounded head-to-head from the Scorecard</span>
            </div>
            <p className="cmp-verdict-line">{verdict.line}</p>
            <div className="cmp-verdict-scores">
              {verdict.entries.map((e, i) => (
                <Link key={e.ticker} href={`/stock/${encodeURIComponent(e.ticker)}`} className={`cmp-verdict-chip${e.ticker === verdict.winner ? " cmp-verdict-win" : ""}`}>
                  <span style={{ color: PALETTE[tickers.indexOf(e.ticker) % PALETTE.length] }}>{e.ticker}</span>
                  <strong>{e.card.overall}<em>/100</em></strong>
                  {e.ticker === verdict.winner && <span className="cmp-verdict-tag">Top score</span>}
                </Link>
              ))}
            </div>
            <p className="cmp-verdict-foot">Computed from valuation, momentum, stability &amp; income — not a recommendation.</p>
          </div>
        )}

        {data.length > 0 && (
          <div className="findec-panel cmp-table-wrap">
            <p className="findec-kicker cmp-table-kicker">Metrics Comparison</p>
            <div className="cmp-table-scroll">
              <table className="cmp-table">
                <thead>
                  <tr>
                    <th className="cmp-th cmp-th-metric">Metric</th>
                    {data.map((d, i) => (
                      <th key={d.ticker} className="cmp-th cmp-th-val">
                        <Link href={`/stock/${encodeURIComponent(d.ticker)}`} style={{ color: PALETTE[i % PALETTE.length] }}>
                          {d.ticker}
                        </Link>
                        {d.quote && <span className="cmp-col-name">{d.quote.name}</span>}
                        {d.errorKind === "not-found" && !d.quote && <span className="cmp-err-label">not found</span>}
                        {d.errorKind === "network" && !d.quote && <span className="cmp-col-name cmp-dim">Unavailable</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {METRICS.map(({ label, key, fmt, higherIsBetter }) => {
                    const vals = data.map((d) => (d.quote ? (d.quote[key] as number | undefined) : undefined));
                    const numVals = vals.filter((v): v is number => typeof v === "number");
                    const best = numVals.length > 1
                      ? (higherIsBetter ? Math.max(...numVals) : null)
                      : null;

                    return (
                      <tr key={label} className="cmp-row">
                        <td className="cmp-td cmp-td-metric">{label}</td>
                        {data.map((d, i) => {
                          const v = d.quote ? (d.quote[key] as number | undefined) : undefined;
                          const isBest = best !== null && v === best;
                          return (
                            <td key={d.ticker} className={`cmp-td cmp-td-val ${isBest ? "cmp-best" : ""}`}>
                              {!d.quote ? (
                                <span className="cmp-dim">-</span>
                              ) : v != null ? (
                                <span
                                  style={{
                                    color: key === "changePercent"
                                      ? (v >= 0 ? "#72b92b" : "#cc5147")
                                      : isBest ? PALETTE[i % PALETTE.length] : undefined,
                                  }}
                                >
                                  {fmt(v)}
                                </span>
                              ) : (
                                <span className="cmp-dim">-</span>
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
          </div>
        )}

        {availableQuotes.length > 0 && (
          <div className="cmp-cta-row">
            {availableQuotes.map((d, i) => (
              <Link key={d.ticker} href={`/brief?ticker=${encodeURIComponent(d.ticker)}`} className="cmp-cta-btn" style={{ borderColor: `${PALETTE[i % PALETTE.length]}55` }}>
                AI Brief · {d.ticker}
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
