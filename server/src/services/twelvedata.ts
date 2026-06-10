import axios from "axios";
import { env } from "../config";

/**
 * Twelve Data integration (v1.17.0).
 *
 * Twelve Data is the primary live-data provider for international markets
 * (India/NSE especially) where Yahoo Finance is IP-blocked on Vercel's cloud
 * IPs and Finnhub's free tier is US-only. Free tier: 800 credits/day, 8/min —
 * so we batch quotes by exchange and rely on the per-symbol/stocks caches in
 * the market controller to stay within budget.
 *
 * Docs: https://twelvedata.com/docs
 */

const BASE = "https://api.twelvedata.com";

export function tdEnabled(): boolean {
  return Boolean(env.twelvedataKey);
}

async function get<T>(path: string, params: Record<string, string | number>): Promise<T> {
  if (!env.twelvedataKey) throw new Error("TWELVEDATA_API_KEY not configured");
  const qs = new URLSearchParams(
    Object.entries({ ...params, apikey: env.twelvedataKey }).map(([k, v]) => [k, String(v)])
  ).toString();
  const { data } = await axios.get<T>(`${BASE}${path}?${qs}`, { timeout: 9000 });
  return data;
}

// ─── Yahoo-suffix ↔ Twelve Data (symbol + exchange) conversion ────────────────
// Our codebase tracks symbols in Yahoo notation (RELIANCE.NS, SHEL.L, 7203.T).
// Twelve Data wants a bare symbol plus an `exchange` query param.
const SUFFIX_TO_EXCHANGE: Record<string, string> = {
  ".NS": "NSE",
  ".BO": "BSE",
  ".L": "LSE",
  ".T": "Tokyo",
  ".SS": "Shanghai",
  ".SZ": "Shenzhen",
};

// Index symbols Twelve Data recognises (best-effort; some need a paid plan).
const INDEX_SYMBOL_MAP: Record<string, string> = {
  "^NSEI": "NIFTY 50",
  "^BSESN": "SENSEX",
  "^GSPC": "GSPC",
  "^DJI": "DJI",
  "^IXIC": "IXIC",
  "^FTSE": "FTSE 100",
  "^N225": "N225",
  "000001.SS": "000001",
  "399001.SZ": "399001",
};

export type TdResolved = { symbol: string; exchange?: string; isIndex: boolean; yahoo: string };

/** Convert a Yahoo-style symbol to the Twelve Data symbol + exchange. */
export function toTwelveData(yahooSymbol: string): TdResolved {
  if (yahooSymbol.startsWith("^") || INDEX_SYMBOL_MAP[yahooSymbol]) {
    return { symbol: INDEX_SYMBOL_MAP[yahooSymbol] ?? yahooSymbol.replace(/^\^/, ""), isIndex: true, yahoo: yahooSymbol };
  }
  for (const [suffix, exchange] of Object.entries(SUFFIX_TO_EXCHANGE)) {
    if (yahooSymbol.endsWith(suffix)) {
      return { symbol: yahooSymbol.slice(0, -suffix.length), exchange, isIndex: false, yahoo: yahooSymbol };
    }
  }
  // US (no suffix) — Twelve Data uses BRK.B not BRK-B.
  return { symbol: yahooSymbol.replace("-", "."), isIndex: false, yahoo: yahooSymbol };
}

// ─── Quote ────────────────────────────────────────────────────────────────────
export interface TdQuote {
  symbol: string;
  name?: string;
  exchange?: string;
  currency?: string;
  datetime?: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  previous_close?: string;
  change?: string;
  percent_change?: string;
  volume?: string;
  average_volume?: string;
  is_market_open?: boolean;
  fifty_two_week?: {
    low?: string;
    high?: string;
  };
  status?: string; // "error" on failure
  code?: number;
  message?: string;
}

function isErr(obj: unknown): obj is { status: "error"; message?: string } {
  return Boolean(obj) && typeof obj === "object" && (obj as { status?: string }).status === "error";
}

/**
 * Batch quote for a set of Yahoo-style symbols that share one exchange (or
 * indices). Twelve Data's `exchange` param applies to the whole call, so callers
 * should group symbols by exchange. Returns a map keyed by the ORIGINAL Yahoo
 * symbol. Tolerates partial failures.
 */
export async function tdQuoteBatch(
  yahooSymbols: string[],
  exchange?: string
): Promise<Map<string, TdQuote>> {
  const out = new Map<string, TdQuote>();
  if (!yahooSymbols.length) return out;

  const resolved = yahooSymbols.map(toTwelveData);
  const tdSymbols = resolved.map((r) => r.symbol);
  // Twelve Data accepts up to 120 symbols per /quote call on most plans; keep
  // batches conservative so a single bad symbol doesn't void the whole response.
  const params: Record<string, string | number> = { symbol: tdSymbols.join(","), dp: 4 };
  if (exchange) params.exchange = exchange;

  let data: Record<string, TdQuote> | TdQuote;
  try {
    data = await get<Record<string, TdQuote> | TdQuote>("/quote", params);
  } catch {
    return out;
  }

  // Single-symbol calls return a flat object; multi-symbol calls return a map
  // keyed by the requested TD symbol.
  const byTdSymbol = new Map<string, TdQuote>();
  if (tdSymbols.length === 1) {
    if (!isErr(data)) byTdSymbol.set(tdSymbols[0], data as TdQuote);
  } else {
    for (const [key, val] of Object.entries(data as Record<string, TdQuote>)) {
      if (!isErr(val)) byTdSymbol.set(key, val);
    }
  }

  for (const r of resolved) {
    const q = byTdSymbol.get(r.symbol);
    if (q && q.close) out.set(r.yahoo, q);
  }
  return out;
}

export async function tdQuoteSingle(yahooSymbol: string): Promise<TdQuote | null> {
  const r = toTwelveData(yahooSymbol);
  const params: Record<string, string | number> = { symbol: r.symbol, dp: 4 };
  if (r.exchange) params.exchange = r.exchange;
  try {
    const data = await get<TdQuote>("/quote", params);
    if (isErr(data) || !data.close) return null;
    return data;
  } catch {
    return null;
  }
}

// ─── Symbol search ──────────────────────────────────────────────────────────
export interface TdSearchItem {
  symbol: string;
  instrument_name?: string;
  exchange?: string;
  mic_code?: string;
  exchange_timezone?: string;
  instrument_type?: string;
  country?: string;
  currency?: string;
}

const EXCHANGE_TO_SUFFIX: Record<string, string> = {
  NSE: ".NS",
  BSE: ".BO",
  LSE: ".L",
  "London Stock Exchange": ".L",
  Tokyo: ".T",
  TSE: ".T",
  XTKS: ".T",
  Shanghai: ".SS",
  SSE: ".SS",
  Shenzhen: ".SZ",
  SZSE: ".SZ",
};

/** Re-attach the Yahoo suffix so the rest of the app (which speaks Yahoo notation) keeps working. */
export function toYahooSymbol(item: { symbol: string; exchange?: string; country?: string }): string {
  const suffix = item.exchange ? EXCHANGE_TO_SUFFIX[item.exchange] : undefined;
  if (suffix && !item.symbol.includes(".")) return `${item.symbol}${suffix}`;
  return item.symbol;
}

export async function tdSearch(query: string): Promise<TdSearchItem[]> {
  try {
    const data = await get<{ data?: TdSearchItem[] }>("/symbol_search", { symbol: query, outputsize: 20 });
    return data.data ?? [];
  } catch {
    return [];
  }
}

// ─── Time series (history + candles) ──────────────────────────────────────────
export interface TdTimeSeriesValue {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
}

export interface TdTimeSeriesResponse {
  meta?: {
    symbol?: string;
    currency?: string;
    exchange?: string;
    type?: string;
  };
  values?: TdTimeSeriesValue[];
  status?: string;
  message?: string;
}

export async function tdTimeSeries(
  yahooSymbol: string,
  interval: "1day" | "1week",
  outputsize: number
): Promise<TdTimeSeriesResponse | null> {
  const r = toTwelveData(yahooSymbol);
  const params: Record<string, string | number> = {
    symbol: r.symbol,
    interval,
    outputsize,
    order: "ASC",
    dp: 4,
  };
  if (r.exchange) params.exchange = r.exchange;
  try {
    const data = await get<TdTimeSeriesResponse>("/time_series", params);
    if (isErr(data) || !data.values?.length) return null;
    return data;
  } catch {
    return null;
  }
}

// ─── Earnings calendar (#8) ───────────────────────────────────────────────────
export interface TdEarningsItem {
  symbol?: string;
  name?: string;
  exchange?: string;
  mic_code?: string;
  currency?: string;
  date?: string;
  time?: string;
  eps_estimate?: number | null;
  eps_actual?: number | null;
  difference?: number | null;
  surprise_prc?: number | null;
}

export interface TdEarningsCalendarResponse {
  earnings?: TdEarningsItem[];
  status?: string;
  message?: string;
}

/**
 * Earnings calendar between two ISO dates (YYYY-MM-DD). Twelve Data returns
 * past + upcoming earnings; callers split by date. May require a paid plan on
 * some tiers — callers fall back to Finnhub on failure.
 */
export async function tdEarningsCalendar(start: string, end: string): Promise<TdEarningsItem[]> {
  try {
    const data = await get<TdEarningsCalendarResponse>("/earnings_calendar", {
      start_date: start,
      end_date: end,
    });
    if (isErr(data) || !data.earnings?.length) return [];
    return data.earnings;
  } catch {
    return [];
  }
}
