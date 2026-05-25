"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getStocks, getStockDetail } from "../services/api";
import type { StockQuote, WatchlistEntry } from "../types";

const WL_KEY = "findec-watchlist";

function loadWatchlist(): WatchlistEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(WL_KEY) ?? "[]") as WatchlistEntry[];
  } catch {
    return [];
  }
}

function saveWatchlist(entries: WatchlistEntry[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WL_KEY, JSON.stringify(entries));
}

function fmtNum(v: number, decimals = 2): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(v);
}

function fmtCap(v: number): string {
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  return v.toLocaleString();
}

interface WatchlistRow extends WatchlistEntry {
  quote: StockQuote | null;
}

export default function Watchlist() {
  const [entries, setEntries] = useState<WatchlistRow[]>([]);
  const [addInput, setAddInput] = useState("");
  const [buyInputs, setBuyInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [addError, setAddError] = useState("");

  useEffect(() => {
    const stored = loadWatchlist();
    void loadQuotes(stored);
  }, []);

  async function loadQuotes(stored: WatchlistEntry[]) {
    setLoading(true);
    if (!stored.length) {
      setEntries([]);
      setLoading(false);
      return;
    }

    const rows: WatchlistRow[] = stored.map((e) => ({ ...e, quote: null }));
    setEntries(rows);

    try {
      const { stocks, indices } = await getStocks();
      const all = [...stocks, ...indices];
      const bySymbol: Record<string, StockQuote> = {};
      all.forEach((s) => { bySymbol[s.symbol.toUpperCase()] = s; });

      const updated = await Promise.all(
        stored.map(async (e): Promise<WatchlistRow> => {
          const key = e.ticker.toUpperCase();
          if (bySymbol[key]) return { ...e, quote: bySymbol[key] };
          try {
            const q = await getStockDetail(e.ticker);
            return { ...e, quote: q };
          } catch {
            return { ...e, quote: null };
          }
        })
      );
      setEntries(updated);
    } catch {
      setEntries(rows);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd() {
    const ticker = addInput.trim().toUpperCase();
    if (!ticker) return;
    setAddError("");
    const stored = loadWatchlist();
    if (stored.find((e) => e.ticker.toUpperCase() === ticker)) {
      setAddError(`${ticker} is already in your watchlist.`);
      return;
    }
    try {
      const q = await getStockDetail(ticker);
      const entry: WatchlistEntry = {
        ticker: q.symbol,
        label: q.name,
        addedAt: new Date().toISOString(),
      };
      const updated = [...stored, entry];
      saveWatchlist(updated);
      setAddInput("");
      void loadQuotes(updated);
    } catch {
      setAddError(`Could not find ticker "${ticker}". Check the symbol and try again.`);
    }
  }

  function handleRemove(ticker: string) {
    const stored = loadWatchlist().filter((e) => e.ticker.toUpperCase() !== ticker.toUpperCase());
    saveWatchlist(stored);
    setEntries((prev) => prev.filter((r) => r.ticker.toUpperCase() !== ticker.toUpperCase()));
  }

  function handleBuyPrice(ticker: string) {
    const raw = buyInputs[ticker] ?? "";
    const price = parseFloat(raw);
    if (isNaN(price) || price <= 0) return;
    const stored = loadWatchlist().map((e) =>
      e.ticker.toUpperCase() === ticker.toUpperCase() ? { ...e, buyPrice: price } : e
    );
    saveWatchlist(stored);
    setEntries((prev) =>
      prev.map((r) => (r.ticker.toUpperCase() === ticker.toUpperCase() ? { ...r, buyPrice: price } : r))
    );
    setBuyInputs((prev) => ({ ...prev, [ticker]: "" }));
  }

  const totalValue = entries.reduce((sum, r) => sum + (r.quote?.price ?? 0), 0);
  const hasAny = entries.length > 0;

  return (
    <section className="findec-minimal-page">
      <div className="findec-minimal-shell">
        <div className="wtch-header-row">
          <div>
            <p className="findec-kicker">Personal Tracker</p>
            <h1 className="wtch-title">Watchlist</h1>
          </div>
          <div className="wtch-summary">
            <span className="findec-kicker">Tracking</span>
            <strong>{entries.length} stock{entries.length !== 1 ? "s" : ""}</strong>
          </div>
        </div>

        {/* Add ticker */}
        <div className="findec-panel wtch-add-panel">
          <p className="findec-kicker">Add to Watchlist</p>
          <div className="wtch-add-row">
            <input
              className="wtch-input"
              placeholder="Ticker symbol, e.g. AAPL or RELIANCE.NS"
              value={addInput}
              onChange={(e) => setAddInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleAdd(); }}
            />
            <button className="wtch-add-btn" onClick={() => void handleAdd()} disabled={!addInput.trim()}>
              + Add
            </button>
          </div>
          {addError && <p className="wtch-add-error">{addError}</p>}
        </div>

        {loading && <p className="findec-kicker wtch-loading">Loading prices…</p>}

        {!loading && !hasAny && (
          <div className="findec-panel wtch-empty">
            <p className="wtch-empty-title">Your watchlist is empty</p>
            <p className="wtch-empty-sub">Add tickers above to track prices and P&amp;L in real time.</p>
            <Link href="/markets" className="wtch-empty-link">Browse Markets →</Link>
          </div>
        )}

        {!loading && hasAny && (
          <div className="wtch-list">
            {entries.map((row) => {
              const q = row.quote;
              const pnlPct = q && row.buyPrice
                ? ((q.price - row.buyPrice) / row.buyPrice) * 100
                : null;

              return (
                <div key={row.ticker} className="findec-panel wtch-card">
                  <div className="wtch-card-top">
                    <div className="wtch-card-left">
                      <Link href={`/stock/${encodeURIComponent(row.ticker)}`} className="wtch-symbol">
                        {row.ticker}
                      </Link>
                      <span className="wtch-name">{q?.name ?? row.label}</span>
                      {q && <span className="wtch-exchange">{q.exchange} · {q.currency}</span>}
                    </div>
                    <div className="wtch-card-right">
                      {q ? (
                        <>
                          <strong className="wtch-price">{fmtNum(q.price)}</strong>
                          <span className={q.changePercent >= 0 ? "findec-subline-up" : "findec-subline-down"}>
                            {q.changePercent >= 0 ? "+" : ""}{fmtNum(q.changePercent)}%
                          </span>
                        </>
                      ) : (
                        <span className="wtch-no-data">No data</span>
                      )}
                    </div>
                  </div>

                  {q && (
                    <div className="wtch-card-metrics">
                      {q.marketCap != null && (
                        <div className="wtch-metric">
                          <span>Mkt Cap</span>
                          <strong>{fmtCap(q.marketCap)}</strong>
                        </div>
                      )}
                      {q.peRatio != null && (
                        <div className="wtch-metric">
                          <span>P/E</span>
                          <strong>{q.peRatio}</strong>
                        </div>
                      )}
                      {q.dividendYield != null && q.dividendYield > 0 && (
                        <div className="wtch-metric">
                          <span>Yield</span>
                          <strong>{q.dividendYield.toFixed(2)}%</strong>
                        </div>
                      )}
                      {q.beta != null && (
                        <div className="wtch-metric">
                          <span>Beta</span>
                          <strong>{q.beta}</strong>
                        </div>
                      )}
                    </div>
                  )}

                  {/* P&L tracker */}
                  <div className="wtch-pnl-row">
                    <div className="wtch-buy-entry">
                      <span className="findec-kicker">Buy price</span>
                      {row.buyPrice != null ? (
                        <div className="wtch-buy-set">
                          <strong>{fmtNum(row.buyPrice)}</strong>
                          {pnlPct != null && (
                            <span className={pnlPct >= 0 ? "findec-subline-up wtch-pnl" : "findec-subline-down wtch-pnl"}>
                              {pnlPct >= 0 ? "+" : ""}{fmtNum(pnlPct)}% P&amp;L
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="wtch-buy-input-row">
                          <input
                            className="wtch-input wtch-buy-input"
                            type="number"
                            placeholder="Enter buy price"
                            value={buyInputs[row.ticker] ?? ""}
                            onChange={(e) => setBuyInputs((prev) => ({ ...prev, [row.ticker]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") handleBuyPrice(row.ticker); }}
                          />
                          <button className="wtch-set-btn" onClick={() => handleBuyPrice(row.ticker)}>Set</button>
                        </div>
                      )}
                    </div>
                    <div className="wtch-card-actions">
                      <Link href={`/brief?ticker=${encodeURIComponent(row.ticker)}`} className="wtch-action-btn wtch-action-brief">
                        AI Brief
                      </Link>
                      <Link href={`/stock/${encodeURIComponent(row.ticker)}`} className="wtch-action-btn">
                        Detail
                      </Link>
                      <button className="wtch-action-btn wtch-action-remove" onClick={() => handleRemove(row.ticker)}>
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {hasAny && totalValue > 0 && (
          <div className="findec-panel wtch-total-panel">
            <span className="findec-kicker">Portfolio snapshot</span>
            <div className="wtch-total-row">
              <span>{entries.length} positions tracked</span>
              <Link href="/screener" className="wtch-total-link">Screen stocks →</Link>
              <Link href="/compare" className="wtch-total-link">Compare →</Link>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
