import axios from "axios";
import { env } from "../config";

const BASE = "https://finnhub.io/api/v1";

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!env.finnhubKey) throw new Error("FINNHUB_API_KEY not configured");
  const qs = new URLSearchParams({ ...params, token: env.finnhubKey }).toString();
  const { data } = await axios.get<T>(`${BASE}${path}?${qs}`, { timeout: 8000 });
  return data;
}

export interface FinnhubQuote {
  c: number;   // current price
  d: number;   // change
  dp: number;  // change percent
  h: number;   // day high
  l: number;   // day low
  o: number;   // open
  pc: number;  // previous close
  t: number;   // timestamp
}

export interface FinnhubProfile {
  name: string;
  exchange: string;
  logo: string;
  currency: string;
  marketCapitalization: number;
  shareOutstanding: number;
  weburl: string;
  finnhubIndustry: string;
  country: string;
  ticker: string;
  ipo: string;
}

export interface FinnhubMetrics {
  metric: {
    "52WeekHigh"?: number | null;
    "52WeekLow"?: number | null;
    "52WeekHighDate"?: string | null;
    "52WeekLowDate"?: string | null;
    "10DayAverageTradingVolume"?: number | null;
    "3MonthAverageTradingVolume"?: number | null;
    betaMonthly?: number | null;
    beta?: number | null;
    bookValuePerShareAnnual?: number | null;
    currentRatioAnnual?: number | null;
    dividendPerShareAnnual?: number | null;
    dividendYieldIndicatedAnnual?: number | null;
    epsBasicExclExtraItemsAnnual?: number | null;
    epsTTM?: number | null;
    netProfitMarginAnnual?: number | null;
    netProfitMarginTTM?: number | null;
    peTTM?: number | null;
    pbAnnual?: number | null;
    roaRfy?: number | null;
    roeTTM?: number | null;
    revenueGrowth3Y?: number | null;
    revenueGrowthTTMYoy?: number | null;
    totalDebtToEquityAnnual?: number | null;
    grossMarginTTM?: number | null;
    ebitdPerShareTTM?: number | null;
    [key: string]: number | string | null | undefined;
  };
}

export interface FinnhubNewsItem {
  id: number;
  headline: string;
  summary: string;
  source: string;
  url: string;
  datetime: number;
  image: string;
  category: string;
  related: string;
}

export interface FinnhubEarningsItem {
  date: string;
  symbol: string;
  company: string;
  epsEstimate: number | null;
  epsActual: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
  quarter: number;
  year: number;
  hour: string;
}

export interface FinnhubIpoItem {
  date: string;
  exchange: string;
  name: string;
  numberOfShares: number;
  price: string;
  status: string;
  symbol: string;
  totalSharesValue: number;
}

export interface FinnhubRecommendation {
  buy: number;
  hold: number;
  period: string;
  sell: number;
  strongBuy: number;
  strongSell: number;
  symbol: string;
}

export function fhQuote(symbol: string): Promise<FinnhubQuote> {
  return get<FinnhubQuote>("/quote", { symbol });
}

export function fhProfile(symbol: string): Promise<FinnhubProfile> {
  return get<FinnhubProfile>("/stock/profile2", { symbol });
}

export function fhMetrics(symbol: string): Promise<FinnhubMetrics> {
  return get<FinnhubMetrics>("/stock/metric", { symbol, metric: "all" });
}

export function fhCompanyNews(symbol: string, from: string, to: string): Promise<FinnhubNewsItem[]> {
  return get<FinnhubNewsItem[]>("/company-news", { symbol, from, to });
}

export function fhMarketNews(category: "general" | "forex" | "crypto" | "merger"): Promise<FinnhubNewsItem[]> {
  return get<FinnhubNewsItem[]>("/news", { category });
}

export function fhEarnings(from: string, to: string): Promise<{ earningsCalendar: FinnhubEarningsItem[] }> {
  return get<{ earningsCalendar: FinnhubEarningsItem[] }>("/calendar/earnings", { from, to });
}

export function fhIpo(from: string, to: string): Promise<{ ipoCalendar: FinnhubIpoItem[] }> {
  return get<{ ipoCalendar: FinnhubIpoItem[] }>("/calendar/ipo", { from, to });
}

export function fhRecommendations(symbol: string): Promise<FinnhubRecommendation[]> {
  return get<FinnhubRecommendation[]>("/stock/recommendation", { symbol });
}
