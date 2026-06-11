import axios from "axios";
import { env } from "../config";

/**
 * Financial Modeling Prep (FMP) integration (v1.21.0).
 *
 * Adds the fundamentals (P/E, market cap, EPS, 52-week range, moving averages,
 * dividend) and the earnings calendar that Finnhub-free (US-only) and
 * Twelve-Data-free don't provide — especially for India/NSE. FMP uses the same
 * Yahoo-style symbols we already track (RELIANCE.NS, AAPL), so no conversion is
 * needed. All helpers no-op gracefully when FMP_API_KEY is unset.
 *
 * Free tier: 250 calls/day — so callers batch (comma-separated symbols) and the
 * market controller caches results.
 *
 * Docs: https://site.financialmodelingprep.com/developer/docs
 */

const BASE = "https://financialmodelingprep.com/api/v3";

export function fmpEnabled(): boolean {
  return Boolean(env.fmpKey);
}

async function get<T>(path: string, params: Record<string, string | number> = {}): Promise<T | null> {
  if (!env.fmpKey) return null;
  const qs = new URLSearchParams(
    Object.entries({ ...params, apikey: env.fmpKey }).map(([k, v]) => [k, String(v)])
  ).toString();
  try {
    const { data } = await axios.get<T>(`${BASE}${path}?${qs}`, { timeout: 9000 });
    return data;
  } catch {
    return null;
  }
}

// ─── Quote (fundamentals in one call, batchable) ──────────────────────────────
export interface FmpQuote {
  symbol: string;
  name?: string;
  price?: number;
  marketCap?: number;
  pe?: number | null;
  eps?: number | null;
  yearHigh?: number | null;
  yearLow?: number | null;
  priceAvg50?: number | null;
  priceAvg200?: number | null;
  volume?: number | null;
  avgVolume?: number | null;
  exchange?: string;
}

/** Batched FMP quote for many symbols (comma-separated). Map keyed by symbol. */
export async function fmpQuoteBatch(symbols: string[]): Promise<Map<string, FmpQuote>> {
  const out = new Map<string, FmpQuote>();
  if (!symbols.length || !env.fmpKey) return out;
  // FMP accepts comma-separated symbols on /quote; keep batches modest.
  const data = await get<FmpQuote[]>(`/quote/${encodeURIComponent(symbols.join(","))}`);
  if (Array.isArray(data)) {
    for (const q of data) if (q.symbol) out.set(q.symbol, q);
  }
  return out;
}

export async function fmpQuoteSingle(symbol: string): Promise<FmpQuote | null> {
  const data = await get<FmpQuote[]>(`/quote/${encodeURIComponent(symbol)}`);
  return Array.isArray(data) && data[0] ? data[0] : null;
}

// ─── Profile (beta, dividend, sector) ─────────────────────────────────────────
export interface FmpProfile {
  symbol: string;
  beta?: number | null;
  lastDiv?: number | null;
  mktCap?: number | null;
  sector?: string;
  industry?: string;
  exchangeShortName?: string;
  companyName?: string;
}

export async function fmpProfile(symbol: string): Promise<FmpProfile | null> {
  const data = await get<FmpProfile[]>(`/profile/${encodeURIComponent(symbol)}`);
  return Array.isArray(data) && data[0] ? data[0] : null;
}

// ─── Ratios (dividend yield, P/B) ─────────────────────────────────────────────
export interface FmpRatiosTtm {
  dividendYielTTM?: number | null; // FMP's (sic) spelling
  dividendYieldTTM?: number | null;
  peRatioTTM?: number | null;
  priceToBookRatioTTM?: number | null;
}

export async function fmpRatiosTtm(symbol: string): Promise<FmpRatiosTtm | null> {
  const data = await get<FmpRatiosTtm[]>(`/ratios-ttm/${encodeURIComponent(symbol)}`);
  return Array.isArray(data) && data[0] ? data[0] : null;
}

// ─── Earnings calendar (#8 — covers US + global) ──────────────────────────────
export interface FmpEarningsItem {
  date: string;
  symbol: string;
  eps?: number | null;          // actual
  epsEstimated?: number | null;
  revenue?: number | null;
  revenueEstimated?: number | null;
  time?: string;                // "bmo" | "amc" | "--"
}

export async function fmpEarningsCalendar(from: string, to: string): Promise<FmpEarningsItem[]> {
  const data = await get<FmpEarningsItem[]>("/earning_calendar", { from, to });
  return Array.isArray(data) ? data : [];
}
