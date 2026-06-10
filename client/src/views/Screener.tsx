"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getStocks } from "../services/api";
import type { StockQuote } from "../types";

function fmtNum(v: number, d = 2): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
}

function fmtCap(v: number): string {
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  return v.toLocaleString();
}

type SortKey = "price" | "changePercent" | "marketCap" | "peRatio" | "dividendYield" | "beta" | "volume";
type SortDir = "asc" | "desc";

interface Filters {
  search: string;
  peMin: string;
  peMax: string;
  capMin: string;
  yieldMin: string;
  betaMax: string;
  maCross: "all" | "golden" | "death";
  changeDir: "all" | "up" | "down";
}

const DEFAULT_FILTERS: Filters = {
  search: "", peMin: "", peMax: "", capMin: "", yieldMin: "", betaMax: "", maCross: "all", changeDir: "all",
};

const CAP_OPTIONS = [
  { label: "Any", value: "" },
  { label: "> $1B", value: "1e9" },
  { label: "> $10B", value: "10e9" },
  { label: "> $100B", value: "100e9" },
  { label: "> $1T", value: "1e12" },
];

function isFiltersActive(f: Filters): boolean {
  return f.search !== "" || f.peMin !== "" || f.peMax !== "" || f.capMin !== "" ||
    f.yieldMin !== "" || f.betaMax !== "" || f.maCross !== "all" || f.changeDir !== "all";
}

export default function Screener() {
  const [stocks, setStocks] = useState<StockQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hasFundamentals, setHasFundamentals] = useState(true);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "marketCap", dir: "desc" });

  useEffect(() => {
    const load = async () => {
      try {
        const { stocks: s } = await getStocks();
        const equities = s.filter((st) => !st.isIndex);
        setStocks(equities);
        // Check if we have real fundamental data
        const withFundamentals = equities.filter((st) =>
          st.peRatio != null ||
          st.marketCap != null ||
          st.ma50 != null ||
          st.high52w != null
        );
        setHasFundamentals(withFundamentals.length > 0);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load stocks.");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const filtered = useMemo(() => {
    let list = [...stocks];

    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter((s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
    }
    if (filters.peMin) {
      const v = parseFloat(filters.peMin);
      if (!isNaN(v)) list = list.filter((s) => s.peRatio != null && s.peRatio >= v);
    }
    if (filters.peMax) {
      const v = parseFloat(filters.peMax);
      if (!isNaN(v)) list = list.filter((s) => s.peRatio != null && s.peRatio <= v);
    }
    if (filters.capMin) {
      const v = parseFloat(filters.capMin);
      if (!isNaN(v)) list = list.filter((s) => s.marketCap != null && s.marketCap >= v);
    }
    if (filters.yieldMin) {
      const v = parseFloat(filters.yieldMin);
      if (!isNaN(v)) list = list.filter((s) => s.dividendYield != null && s.dividendYield >= v);
    }
    if (filters.betaMax) {
      const v = parseFloat(filters.betaMax);
      if (!isNaN(v)) list = list.filter((s) => s.beta != null && s.beta <= v);
    }
    if (filters.maCross === "golden") {
      list = list.filter((s) => s.ma50 != null && s.ma200 != null && s.ma50 > s.ma200);
    } else if (filters.maCross === "death") {
      list = list.filter((s) => s.ma50 != null && s.ma200 != null && s.ma50 < s.ma200);
    }
    if (filters.changeDir === "up") list = list.filter((s) => s.changePercent > 0);
    else if (filters.changeDir === "down") list = list.filter((s) => s.changePercent < 0);

    list.sort((a, b) => {
      const av = (a[sort.key] as number | undefined) ?? (sort.dir === "asc" ? Infinity : -Infinity);
      const bv = (b[sort.key] as number | undefined) ?? (sort.dir === "asc" ? Infinity : -Infinity);
      return sort.dir === "asc" ? av - bv : bv - av;
    });

    return list;
  }, [stocks, filters, sort]);

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }
    );
  }

  function setF<K extends keyof Filters>(key: K, val: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: val }));
  }

  const sortArrow = (key: SortKey) =>
    sort.key === key ? (sort.dir === "desc" ? " ↓" : " ↑") : "";

  const activeFilters = isFiltersActive(filters);
  const noResults = !loading && !error && filtered.length === 0;

  return (
    <section className="findec-minimal-page">
      <div className="findec-minimal-shell scr-shell">
        <div className="scr-header">
          <div>
            <p className="findec-kicker">Stock Screener</p>
            <h1 className="scr-title">Filter &amp; Find</h1>
          </div>
          <div className="scr-header-right">
            {!loading && !error && (
              <span className="scr-count">{filtered.length} of {stocks.length}</span>
            )}
            {!loading && !error && (
              <Link href="/compare" className="scr-compare-btn">Compare →</Link>
            )}
          </div>
        </div>

        {!loading && !hasFundamentals && false && (
          <div className="scr-notice">
            Live fundamentals unavailable — showing price and direction data only. Fundamental filters (P/E, cap, yield) will not apply.
          </div>
        )}

        {!loading && !error && !hasFundamentals && (
          <div className="scr-notice">
            Live fundamentals are unavailable from the current market data provider right now. Fundamental filters (P/E, cap, yield) will not apply.
          </div>
        )}

        {/* Filters */}
        <div className="findec-panel scr-filters">
          <div className="scr-filter-grid">
            <div className="scr-filter-group scr-filter-wide">
              <label className="findec-kicker">Search</label>
              <input
                className="scr-input"
                placeholder="Symbol or company name…"
                value={filters.search}
                onChange={(e) => setF("search", e.target.value)}
              />
            </div>
            <div className="scr-filter-group">
              <label className="findec-kicker">P/E Min</label>
              <input className="scr-input" type="number" placeholder="e.g. 5" value={filters.peMin} onChange={(e) => setF("peMin", e.target.value)} />
            </div>
            <div className="scr-filter-group">
              <label className="findec-kicker">P/E Max</label>
              <input className="scr-input" type="number" placeholder="e.g. 30" value={filters.peMax} onChange={(e) => setF("peMax", e.target.value)} />
            </div>
            <div className="scr-filter-group">
              <label className="findec-kicker">Market Cap</label>
              <select className="scr-input scr-select" value={filters.capMin} onChange={(e) => setF("capMin", e.target.value)}>
                {CAP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="scr-filter-group">
              <label className="findec-kicker">Div Yield ≥ %</label>
              <input className="scr-input" type="number" placeholder="e.g. 2" step="0.1" value={filters.yieldMin} onChange={(e) => setF("yieldMin", e.target.value)} />
            </div>
            <div className="scr-filter-group">
              <label className="findec-kicker">Beta ≤</label>
              <input className="scr-input" type="number" placeholder="e.g. 1.5" step="0.1" value={filters.betaMax} onChange={(e) => setF("betaMax", e.target.value)} />
            </div>
            <div className="scr-filter-group">
              <label className="findec-kicker">MA Cross</label>
              <select className="scr-input scr-select" value={filters.maCross} onChange={(e) => setF("maCross", e.target.value as Filters["maCross"])}>
                <option value="all">All</option>
                <option value="golden">Golden Cross ↑</option>
                <option value="death">Death Cross ↓</option>
              </select>
            </div>
            <div className="scr-filter-group">
              <label className="findec-kicker">Today</label>
              <select className="scr-input scr-select" value={filters.changeDir} onChange={(e) => setF("changeDir", e.target.value as Filters["changeDir"])}>
                <option value="all">All</option>
                <option value="up">Gaining ↑</option>
                <option value="down">Losing ↓</option>
              </select>
            </div>
          </div>
          {activeFilters && (
            <button className="scr-reset-btn" onClick={() => setFilters(DEFAULT_FILTERS)}>
              ✕ Clear filters
            </button>
          )}
        </div>

        {error && <div className="findec-panel scr-error">{error}</div>}
        {loading && <p className="findec-kicker scr-loading">Loading stocks…</p>}

        {noResults && activeFilters && (
          <div className="findec-panel scr-no-results">
            <p className="scr-no-results-title">No stocks match these filters</p>
            <p className="scr-no-results-sub">
              {!hasFundamentals
                ? "Fundamental data (P/E, market cap, yield) is not available for the current dataset. Try filtering by price direction or symbol name."
                : "Try widening your filter ranges."}
            </p>
            <button className="scr-reset-btn scr-reset-inline" onClick={() => setFilters(DEFAULT_FILTERS)}>Reset all filters</button>
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="findec-panel scr-table-wrap">
            <table className="scr-table">
              <thead>
                <tr>
                  <th className="scr-th scr-th-name">Stock</th>
                  <th className="scr-th scr-th-r" onClick={() => toggleSort("price")}>Price{sortArrow("price")}</th>
                  <th className="scr-th scr-th-r" onClick={() => toggleSort("changePercent")}>Day%{sortArrow("changePercent")}</th>
                  <th className="scr-th scr-th-r scr-hide-sm" onClick={() => toggleSort("marketCap")}>Cap{sortArrow("marketCap")}</th>
                  <th className="scr-th scr-th-r scr-hide-sm" onClick={() => toggleSort("peRatio")}>P/E{sortArrow("peRatio")}</th>
                  <th className="scr-th scr-th-r scr-hide-md" onClick={() => toggleSort("dividendYield")}>Yield{sortArrow("dividendYield")}</th>
                  <th className="scr-th scr-th-r scr-hide-md" onClick={() => toggleSort("beta")}>Beta{sortArrow("beta")}</th>
                  <th className="scr-th scr-th-r scr-hide-md">MA Cross</th>
                  <th className="scr-th"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const cross = s.ma50 != null && s.ma200 != null
                    ? s.ma50 > s.ma200 ? "golden" : "death"
                    : null;
                  return (
                    <tr key={s.symbol} className="scr-row">
                      <td className="scr-td scr-td-name">
                        <Link href={`/stock/${encodeURIComponent(s.symbol)}`} className="scr-symbol">{s.symbol}</Link>
                        <Link href={`/stock/${encodeURIComponent(s.symbol)}`} className="scr-name scr-name-link">{s.name}</Link>
                      </td>
                      <td className="scr-td scr-td-r">{fmtNum(s.price)}</td>
                      <td className={`scr-td scr-td-r ${s.changePercent >= 0 ? "findec-subline-up" : "findec-subline-down"}`}>
                        {s.changePercent >= 0 ? "+" : ""}{fmtNum(s.changePercent)}%
                      </td>
                      <td className="scr-td scr-td-r scr-hide-sm">{s.marketCap != null ? fmtCap(s.marketCap) : <span className="scr-dim">—</span>}</td>
                      <td className="scr-td scr-td-r scr-hide-sm">{s.peRatio != null ? s.peRatio : <span className="scr-dim">—</span>}</td>
                      <td className="scr-td scr-td-r scr-hide-md">
                        {s.dividendYield != null && s.dividendYield > 0 ? `${s.dividendYield.toFixed(2)}%` : <span className="scr-dim">—</span>}
                      </td>
                      <td className="scr-td scr-td-r scr-hide-md">{s.beta != null ? s.beta : <span className="scr-dim">—</span>}</td>
                      <td className="scr-td scr-td-r scr-hide-md">
                        {cross === "golden" && <span className="findec-subline-up">Golden ↑</span>}
                        {cross === "death" && <span className="findec-subline-down">Death ↓</span>}
                        {cross === null && <span className="scr-dim">—</span>}
                      </td>
                      <td className="scr-td scr-td-actions">
                        <Link href={`/stock/${encodeURIComponent(s.symbol)}`} className="scr-action">View</Link>
                        <Link href={`/compare?tickers=${encodeURIComponent(s.symbol)}`} className="scr-action">Compare</Link>
                        <Link href={`/brief?ticker=${encodeURIComponent(s.symbol)}`} className="scr-action scr-action-brief">Brief</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
