"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getStocks, getStockDetail, searchStocks, type StockSearchResult } from "../services/api";
import type { StockQuote, WatchlistEntry } from "../types";

const WL_KEY = "findec-watchlist";

function loadWatchlist(): WatchlistEntry[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(window.localStorage.getItem(WL_KEY) ?? "[]") as WatchlistEntry[]; }
  catch { return []; }
}

function saveWatchlist(entries: WatchlistEntry[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WL_KEY, JSON.stringify(entries));
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

interface WatchlistRow extends WatchlistEntry { quote: StockQuote | null; }

function useDebounce<T>(value: T, delay: number): T {
  const [dv, setDv] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDv(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return dv;
}

export default function Watchlist() {
  const [entries, setEntries] = useState<WatchlistRow[]>([]);
  const [addInput, setAddInput] = useState("");
  const [buyInputs, setBuyInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [addError, setAddError] = useState("");
  const [searchResults, setSearchResults] = useState<StockSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const debouncedInput = useDebounce(addInput, 300);

  // Search autocomplete
  useEffect(() => {
    if (debouncedInput.length < 1) { setSearchResults([]); setShowDropdown(false); return; }
    setSearching(true);
    searchStocks(debouncedInput)
      .then((res) => {
        setSearchResults(res.results);
        setShowDropdown(res.results.length > 0);
      })
      .catch(() => setSearchResults([]))
      .finally(() => setSearching(false));
  }, [debouncedInput]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node) && !inputRef.current?.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    void loadQuotes(loadWatchlist());
  }, []);

  async function loadQuotes(stored: WatchlistEntry[]) {
    setLoading(true);
    if (!stored.length) { setEntries([]); setLoading(false); return; }

    const rows: WatchlistRow[] = stored.map((e) => ({ ...e, quote: null }));
    setEntries(rows);

    try {
      const { stocks, indices } = await getStocks();
      const bySymbol: Record<string, StockQuote> = {};
      [...stocks, ...indices].forEach((s) => { bySymbol[s.symbol.toUpperCase()] = s; });

      const updated = await Promise.all(
        stored.map(async (e): Promise<WatchlistRow> => {
          const found = bySymbol[e.ticker.toUpperCase()];
          if (found) return { ...e, quote: found };
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

  const selectResult = useCallback(async (result: StockSearchResult) => {
    setShowDropdown(false);
    setAddInput("");
    setAddError("");
    const stored = loadWatchlist();
    if (stored.find((e) => e.ticker.toUpperCase() === result.symbol.toUpperCase())) {
      setAddError(`${result.symbol} is already in your watchlist.`);
      return;
    }
    const entry: WatchlistEntry = {
      ticker: result.symbol,
      label: result.name,
      addedAt: new Date().toISOString()
    };
    const updated = [...stored, entry];
    saveWatchlist(updated);
    void loadQuotes(updated);
  }, []);

  async function handleManualAdd() {
    const ticker = addInput.trim().toUpperCase();
    if (!ticker) return;
    setAddError("");
    setShowDropdown(false);
    const stored = loadWatchlist();
    if (stored.find((e) => e.ticker.toUpperCase() === ticker)) {
      setAddError(`${ticker} is already in your watchlist.`);
      return;
    }
    try {
      const q = await getStockDetail(ticker);
      const entry: WatchlistEntry = { ticker: q.symbol, label: q.name, addedAt: new Date().toISOString() };
      const updated = [...stored, entry];
      saveWatchlist(updated);
      setAddInput("");
      void loadQuotes(updated);
    } catch {
      setAddError(`"${ticker}" not found. Try searching by company name, or use the full Yahoo Finance symbol (e.g. RELIANCE.NS, SHEL.L).`);
    }
  }

  function handleRemove(ticker: string) {
    const stored = loadWatchlist().filter((e) => e.ticker.toUpperCase() !== ticker.toUpperCase());
    saveWatchlist(stored);
    setEntries((prev) => prev.filter((r) => r.ticker.toUpperCase() !== ticker.toUpperCase()));
  }

  function handleBuyPrice(ticker: string) {
    const price = parseFloat(buyInputs[ticker] ?? "");
    if (isNaN(price) || price <= 0) return;
    const stored = loadWatchlist().map((e) =>
      e.ticker.toUpperCase() === ticker.toUpperCase() ? { ...e, buyPrice: price } : e
    );
    saveWatchlist(stored);
    setEntries((prev) =>
      prev.map((r) => r.ticker.toUpperCase() === ticker.toUpperCase() ? { ...r, buyPrice: price } : r)
    );
    setBuyInputs((prev) => ({ ...prev, [ticker]: "" }));
  }

  function clearBuyPrice(ticker: string) {
    const stored = loadWatchlist().map((e) =>
      e.ticker.toUpperCase() === ticker.toUpperCase() ? { ...e, buyPrice: undefined } : e
    );
    saveWatchlist(stored);
    setEntries((prev) =>
      prev.map((r) => r.ticker.toUpperCase() === ticker.toUpperCase() ? { ...r, buyPrice: undefined } : r)
    );
  }

  return (
    <section className="findec-minimal-page">
      <div className="findec-minimal-shell">
        <div className="wtch-header-row">
          <div>
            <p className="findec-kicker">Personal Tracker</p>
            <h1 className="wtch-title">Watchlist</h1>
          </div>
          {entries.length > 0 && (
            <div className="wtch-summary">
              <span className="findec-kicker">Tracking</span>
              <strong>{entries.length} stock{entries.length !== 1 ? "s" : ""}</strong>
            </div>
          )}
        </div>

        {/* Add panel with autocomplete */}
        <div className="findec-panel wtch-add-panel">
          <p className="findec-kicker">Add any stock, ETF, or index</p>
          <div className="wtch-add-row">
            <div className="wtch-search-wrap">
              <input
                ref={inputRef}
                className="wtch-input"
                placeholder="Search by company name or ticker — e.g. Apple, RELIANCE, MSFT"
                value={addInput}
                onChange={(e) => { setAddInput(e.target.value); setAddError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") void handleManualAdd(); if (e.key === "Escape") setShowDropdown(false); }}
                onFocus={() => { if (searchResults.length > 0) setShowDropdown(true); }}
              />
              {showDropdown && (
                <div ref={dropdownRef} className="wtch-dropdown">
                  {searchResults.map((r) => (
                    <button key={r.symbol} className="wtch-dropdown-item" onMouseDown={() => void selectResult(r)}>
                      <span className="wtch-dd-symbol">{r.symbol}</span>
                      <span className="wtch-dd-name">{r.name}</span>
                      <span className="wtch-dd-exchange">{r.exchange}</span>
                    </button>
                  ))}
                </div>
              )}
              {searching && <span className="wtch-searching">Searching…</span>}
            </div>
            <button className="wtch-add-btn" onClick={() => void handleManualAdd()} disabled={!addInput.trim()}>
              + Add
            </button>
          </div>
          {addError && <p className="wtch-add-error">{addError}</p>}
          <p className="wtch-add-hint">Supports NYSE, NASDAQ, NSE (.NS), BSE (.BO), LSE (.L), TSE (.T), and more.</p>
        </div>

        {loading && <p className="findec-kicker wtch-loading">Loading prices…</p>}

        {!loading && entries.length === 0 && (
          <div className="findec-panel wtch-empty">
            <p className="wtch-empty-title">Your watchlist is empty</p>
            <p className="wtch-empty-sub">Search for any company above to start tracking prices and P&amp;L.</p>
            <Link href="/markets" className="wtch-empty-link">Browse Markets →</Link>
          </div>
        )}

        {!loading && entries.length > 0 && (
          <div className="wtch-list">
            {entries.map((row) => {
              const q = row.quote;
              const pnlPct = q && row.buyPrice
                ? ((q.price - row.buyPrice) / row.buyPrice) * 100 : null;

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
                        <span className="wtch-no-data">Price unavailable</span>
                      )}
                    </div>
                  </div>

                  {q && (
                    <div className="wtch-card-metrics">
                      {q.marketCap != null && <div className="wtch-metric"><span>Mkt Cap</span><strong>{fmtCap(q.marketCap)}</strong></div>}
                      {q.peRatio != null && <div className="wtch-metric"><span>P/E</span><strong>{q.peRatio}</strong></div>}
                      {q.dividendYield != null && q.dividendYield > 0 && <div className="wtch-metric"><span>Yield</span><strong>{q.dividendYield.toFixed(2)}%</strong></div>}
                      {q.beta != null && <div className="wtch-metric"><span>Beta</span><strong>{q.beta}</strong></div>}
                      {q.high52w != null && q.low52w != null && (
                        <div className="wtch-metric"><span>52W Range</span><strong>{fmtNum(q.low52w)} – {fmtNum(q.high52w)}</strong></div>
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
                          <button className="wtch-clear-buy" onClick={() => clearBuyPrice(row.ticker)} title="Clear buy price">×</button>
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
                      <Link href={`/brief?ticker=${encodeURIComponent(row.ticker)}`} className="wtch-action-btn wtch-action-brief">AI Brief</Link>
                      <Link href={`/stock/${encodeURIComponent(row.ticker)}`} className="wtch-action-btn">Detail</Link>
                      <Link href={`/compare?tickers=${encodeURIComponent(row.ticker)}`} className="wtch-action-btn">Compare</Link>
                      <button className="wtch-action-btn wtch-action-remove" onClick={() => handleRemove(row.ticker)}>Remove</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
