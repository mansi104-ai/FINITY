import axios from "axios";
import type { Request, Response } from "express";
import {
  getGeolocation,
  type StockMarket,
  type GeoLocation
} from "../utils/geolocation";
import { readStocksCache, writeStocksCache, readSnapshotCache, writeSnapshotCache, readQuoteCache, writeQuoteCache } from "../store/db";
import { env } from "../config";
import {
  fhCompanyNews,
  fhEarnings,
  fhIpo,
  fhMarketNews,
  fhMetrics,
  fhProfile,
  fhQuote,
  fhRecommendations,
  type FinnhubNewsItem,
} from "../services/finnhub";

const NEW_YORK_TIMEZONE = "America/New_York";
const STOCK_CACHE_TTL_MS = 30 * 60 * 1000;
const SNAPSHOT_CACHE_STALE_MAX_MS = 4 * 60 * 60 * 1000;
const YAHOO_REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

// ─── Tracked symbols (used for batch fetching, not as fallback price data) ───
const COUNTRY_TRACKED_SYMBOLS: Record<string, string[]> = {
  IN: [
    "^NSEI", "^BSESN",
    "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS",
    "SBIN.NS", "WIPRO.NS", "BAJFINANCE.NS", "LT.NS", "ASIANPAINT.NS",
    "AXISBANK.NS", "MARUTI.NS", "HCLTECH.NS", "ULTRACEMCO.NS", "ONGC.NS",
    "KOTAKBANK.NS", "BHARTIARTL.NS", "TITAN.NS", "SUNPHARMA.NS", "NTPC.NS",
    "POWERGRID.NS", "ADANIENT.NS", "NESTLEIND.NS", "HINDUNILVR.NS",
    "DIVISLAB.NS", "DRREDDY.NS", "COALINDIA.NS", "TECHM.NS", "CIPLA.NS",
    "BAJAJFINSV.NS", "EICHERMOT.NS", "HEROMOTOCO.NS", "TATAMOTORS.NS",
    "TATASTEEL.NS", "JSWSTEEL.NS", "BPCL.NS", "IOC.NS", "HINDALCO.NS",
    "GRASIM.NS", "UPL.NS", "BRITANNIA.NS", "TATACONSUM.NS", "INDUSINDBK.NS"
  ],
  US: [
    "^GSPC", "^DJI", "^IXIC",
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "BRK-B",
    "JPM", "LLY", "UNH", "V", "XOM", "MA", "JNJ", "PG", "HD", "COST",
    "ABBV", "MRK", "CVX", "KO", "WMT", "BAC", "PEP", "CRM", "NFLX",
    "ORCL", "ACN", "MCD", "ADBE", "TMO", "AMD", "PM", "CSCO", "IBM",
    "CAT", "GS", "ISRG", "AXP", "AMGN", "TXN", "QCOM", "GILD",
    "LOW", "SYK", "HON", "ETN", "UBER", "INTU", "C", "UNP", "PYPL",
    "AMAT", "LRCX", "MU", "NOW", "PANW", "SNOW", "PLTR", "COIN", "F", "GM"
  ],
  GB: [
    "^FTSE",
    "SHEL.L", "AZN.L", "HSBA.L", "BP.L", "ULVR.L", "RIO.L", "GSK.L",
    "LLOY.L", "DGE.L", "REL.L", "BARC.L", "NG.L", "BATS.L", "PRU.L",
    "LGEN.L", "SSE.L", "FLTR.L", "CPG.L", "VOD.L", "BT-A.L"
  ],
  JP: [
    "^N225",
    "7203.T", "6758.T", "9984.T", "6501.T", "8306.T",
    "6954.T", "8035.T", "9432.T", "7974.T", "4063.T",
    "6367.T", "9433.T", "4502.T", "2802.T", "9022.T", "8316.T"
  ],
  CN: [
    "000001.SS", "399001.SZ",
    "600519.SS", "601318.SS", "600036.SS", "601888.SS",
    "600276.SS", "000858.SZ", "601166.SS", "600900.SS",
    "601398.SS", "601288.SS", "000333.SZ", "002415.SZ", "600309.SS"
  ]
};

const INDEX_SYMBOLS: Record<string, string[]> = {
  IN: ["^NSEI", "^BSESN"],
  US: ["^GSPC", "^DJI", "^IXIC"],
  GB: ["^FTSE"],
  JP: ["^N225"],
  CN: ["000001.SS", "399001.SZ"]
};

// ─── Types ────────────────────────────────────────────────────────────────────
type YahooQuote = {
  symbol?: string;
  shortName?: string;
  regularMarketPrice?: number;
  regularMarketPreviousClose?: number;
  regularMarketChangePercent?: number;
};

type YahooDetailedQuote = {
  symbol?: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  regularMarketPreviousClose?: number;
  regularMarketChange?: number;
  regularMarketChangePercent?: number;
  regularMarketVolume?: number;
  averageVolume?: number;
  marketCap?: number;
  trailingPE?: number;
  forwardPE?: number;
  dividendYield?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  fiftyDayAverage?: number;
  twoHundredDayAverage?: number;
  fullExchangeName?: string;
  currency?: string;
  epsTrailingTwelveMonths?: number;
  epsForward?: number;
  priceToBook?: number;
  bookValue?: number;
  trailingAnnualDividendYield?: number;
  beta?: number;
};

export type StockQuoteResponse = {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  price: number;
  lastClose: number;
  change: number;
  changePercent: number;
  volume?: number;
  avgVolume?: number;
  marketCap?: number;
  peRatio?: number;
  forwardPE?: number;
  dividendYield?: number;
  high52w?: number;
  low52w?: number;
  ma50?: number;
  ma200?: number;
  eps?: number;
  epsForward?: number;
  priceToBook?: number;
  beta?: number;
  isIndex: boolean;
};

type MarketSnapshotResponse = {
  asOf: string;
  geoLocation: { country: string; countryCode: string; timezone: string };
  market: {
    isOpen: boolean; phase: "open" | "closed"; label: string;
    timezone: string; sessionHours: string; market: string;
  };
  lastTradingDayLabel: string;
  featuredTickers: Array<{ symbol: string; name: string; exchange: string; reason: string }>;
  tickers: Array<{ symbol: string; name: string; lastClose: number; changePercent: number }>;
};

type MarketHistoryPoint = { date: string; close: number };
type MarketHistoryResponse = {
  symbol: string; name: string; currency: string;
  points: MarketHistoryPoint[]; latestClose: number;
  changePercent30d: number; high30d: number; low30d: number;
  source: "yahoo";
};

type StocksListResponse = {
  stocks: StockQuoteResponse[];
  indices: StockQuoteResponse[];
  countryCode: string;
  asOf: string;
};

type NewsArticle = {
  title: string; description?: string; url: string;
  source: { name: string }; publishedAt: string;
  sentiment: "bullish" | "bearish" | "neutral";
  imageUrl?: string;
  category?: string;
};

// ─── MongoDB stock cache ──────────────────────────────────────────────────────
async function getStocksCache(
  countryCode: string,
  options: { allowStale?: boolean } = {}
): Promise<{ stocks: StockQuoteResponse[]; indices: StockQuoteResponse[] } | null> {
  try {
    const doc = await readStocksCache(countryCode);
    if (!doc) return null;
    const age = Date.now() - new Date(doc.cachedAt).getTime();
    if (!options.allowStale && age > STOCK_CACHE_TTL_MS) return null;
    return { stocks: doc.stocks, indices: doc.indices };
  } catch {
    return null;
  }
}

async function setStocksCache(countryCode: string, stocks: StockQuoteResponse[], indices: StockQuoteResponse[]): Promise<void> {
  try {
    await writeStocksCache(countryCode, stocks, indices);
  } catch { /* non-critical */ }
}

// ─── MongoDB snapshot cache ───────────────────────────────────────────────────
async function getSnapshotCache(countryCode: string): Promise<MarketSnapshotResponse["tickers"] | null> {
  try {
    const doc = await readSnapshotCache(countryCode);
    if (!doc) return null;
    const age = Date.now() - new Date(doc.cachedAt).getTime();
    if (age > SNAPSHOT_CACHE_STALE_MAX_MS) return null;
    return doc.tickers as MarketSnapshotResponse["tickers"];
  } catch {
    return null;
  }
}

async function setSnapshotCache(countryCode: string, tickers: MarketSnapshotResponse["tickers"]): Promise<void> {
  try {
    await writeSnapshotCache(countryCode, tickers as unknown[]);
  } catch { /* non-critical */ }
}

// ─── Featured tickers ─────────────────────────────────────────────────────────
const COUNTRY_FEATURED_TICKERS: Record<string, Array<{ symbol: string; name: string; exchange: string; reason: string }>> = {
  IN: [
    { symbol: "RELIANCE.NS", name: "Reliance Industries", exchange: "NSE", reason: "Energy, telecom and retail — a bellwether of the Indian economy." },
    { symbol: "TCS.NS", name: "Tata Consultancy Services", exchange: "NSE", reason: "India's largest IT exporter, global services revenue." },
    { symbol: "HDFCBANK.NS", name: "HDFC Bank", exchange: "NSE", reason: "Largest private bank by market cap, proxy for domestic credit growth." }
  ],
  US: [
    { symbol: "AAPL", name: "Apple", exchange: "NASDAQ", reason: "Mega-cap quality benchmark for US large-cap investors." },
    { symbol: "NVDA", name: "NVIDIA", exchange: "NASDAQ", reason: "Highest-conviction AI infrastructure name in the US market." },
    { symbol: "MSFT", name: "Microsoft", exchange: "NASDAQ", reason: "Cloud + AI exposure with strong balance-sheet quality." }
  ],
  GB: [
    { symbol: "SHEL.L", name: "Shell", exchange: "LSE", reason: "UK-listed global energy major." },
    { symbol: "AZN.L", name: "AstraZeneca", exchange: "LSE", reason: "UK flagship pharma with global pipeline." },
    { symbol: "HSBA.L", name: "HSBC", exchange: "LSE", reason: "Large international bank with Asia exposure." }
  ],
  JP: [
    { symbol: "7203.T", name: "Toyota Motor", exchange: "TSE", reason: "Core Japanese industrial and auto exporter." },
    { symbol: "6758.T", name: "Sony Group", exchange: "TSE", reason: "Consumer tech and entertainment exposure." },
    { symbol: "9984.T", name: "SoftBank Group", exchange: "TSE", reason: "High-beta tech investment vehicle." }
  ],
  CN: [
    { symbol: "600519.SS", name: "Kweichow Moutai", exchange: "SSE", reason: "Flagship mainland consumer brand." },
    { symbol: "601318.SS", name: "Ping An Insurance", exchange: "SSE", reason: "Major Chinese financial services." },
    { symbol: "600036.SS", name: "China Merchants Bank", exchange: "SSE", reason: "Frequently tracked Chinese banking stock." }
  ]
};

function getFeaturedTickersForCountry(c: string) { return COUNTRY_FEATURED_TICKERS[c] ?? COUNTRY_FEATURED_TICKERS.US; }
function getTrackedSymbolsForCountry(c: string) { return COUNTRY_TRACKED_SYMBOLS[c] ?? COUNTRY_TRACKED_SYMBOLS.US; }
function getIndexSymbolsForCountry(c: string) { return INDEX_SYMBOLS[c] ?? INDEX_SYMBOLS.US; }

// ─── Market status helpers ────────────────────────────────────────────────────
function getMarketStatusForMarket(now: Date, market: StockMarket) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: market.timezone, weekday: "short",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  const minutesFromMidnight = hour * 60 + minute;
  const openMinutes = market.openHour * 60 + market.openMinute;
  const closeMinutes = market.closeHour * 60 + market.closeMinute;
  const isOpen = market.openDays.includes(dayIndex) && minutesFromMidnight >= openMinutes && minutesFromMidnight < closeMinutes;
  return {
    isOpen, phase: isOpen ? "open" : "closed",
    label: isOpen ? `${market.label} is open` : `${market.label} is closed`,
    timezone: market.timezone,
    sessionHours: `${String(market.openHour).padStart(2, "0")}:${String(market.openMinute).padStart(2, "0")} - ${String(market.closeHour).padStart(2, "0")}:${String(market.closeMinute).padStart(2, "0")}`,
    market: market.code
  } as const;
}

function getLastTradingDayLabel(now: Date, timezone = NEW_YORK_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "short", day: "numeric", weekday: "short"
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const month = parts.find((p) => p.type === "month")?.value ?? "Jan";
  const day = Number(parts.find((p) => p.type === "day")?.value ?? "1");
  const year = Number(parts.find((p) => p.type === "year")?.value ?? "2026");
  const currentWeekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  const date = new Date(Date.UTC(year, new Date(`${month} 1, ${year}`).getMonth(), day));
  let offsetDays = 1;
  if (currentWeekday === 1) offsetDays = 3;
  else if (currentWeekday === 0) offsetDays = 2;
  date.setUTCDate(date.getUTCDate() - offsetDays);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(date);
}

// ─── Yahoo Finance helpers ────────────────────────────────────────────────────
async function fetchQuotes(symbolsToTrack: string[]): Promise<MarketSnapshotResponse["tickers"]> {
  const response = await axios.get<{ quoteResponse?: { result?: YahooQuote[] } }>(
    "https://query1.finance.yahoo.com/v7/finance/quote",
    { params: { symbols: symbolsToTrack.join(",") }, timeout: 6000, headers: YAHOO_REQUEST_HEADERS }
  );
  const result = response.data.quoteResponse?.result ?? [];
  if (!result.length) throw new Error("No quote data");
  return result.map((q) => ({
    symbol: q.symbol ?? "N/A",
    name: q.shortName ?? q.symbol ?? "Ticker",
    lastClose: Number(q.regularMarketPreviousClose ?? q.regularMarketPrice ?? 0),
    changePercent: Number(q.regularMarketChangePercent ?? 0)
  }));
}

const YAHOO_FIELDS = [
  "symbol", "shortName", "longName", "regularMarketPrice", "regularMarketPreviousClose",
  "regularMarketChange", "regularMarketChangePercent", "regularMarketVolume", "averageVolume",
  "marketCap", "trailingPE", "forwardPE", "dividendYield", "fiftyTwoWeekHigh",
  "fiftyTwoWeekLow", "fiftyDayAverage", "twoHundredDayAverage", "fullExchangeName",
  "currency", "epsTrailingTwelveMonths", "epsForward", "priceToBook", "bookValue",
  "trailingAnnualDividendYield", "beta"
].join(",");

function mapDetailedQuote(q: YahooDetailedQuote, indexSymbols: Set<string>): StockQuoteResponse {
  const price = Number(q.regularMarketPrice ?? q.regularMarketPreviousClose ?? 0);
  const lastClose = Number(q.regularMarketPreviousClose ?? price);
  const change = Number(q.regularMarketChange ?? price - lastClose);
  const changePercent = Number(q.regularMarketChangePercent ?? 0);
  const divYield = q.dividendYield != null
    ? Number((q.dividendYield * 100).toFixed(2))
    : q.trailingAnnualDividendYield != null
      ? Number((q.trailingAnnualDividendYield * 100).toFixed(2))
      : undefined;
  return {
    symbol: q.symbol ?? "N/A",
    name: q.shortName ?? q.longName ?? q.symbol ?? "Unknown",
    exchange: q.fullExchangeName ?? "",
    currency: q.currency ?? "USD",
    price, lastClose, change: +change.toFixed(2), changePercent: +changePercent.toFixed(4),
    volume: q.regularMarketVolume != null ? Number(q.regularMarketVolume) : undefined,
    avgVolume: q.averageVolume != null ? Number(q.averageVolume) : undefined,
    marketCap: q.marketCap != null ? Number(q.marketCap) : undefined,
    peRatio: q.trailingPE != null ? +Number(q.trailingPE).toFixed(2) : undefined,
    forwardPE: q.forwardPE != null ? +Number(q.forwardPE).toFixed(2) : undefined,
    dividendYield: divYield,
    high52w: q.fiftyTwoWeekHigh != null ? +Number(q.fiftyTwoWeekHigh).toFixed(2) : undefined,
    low52w: q.fiftyTwoWeekLow != null ? +Number(q.fiftyTwoWeekLow).toFixed(2) : undefined,
    ma50: q.fiftyDayAverage != null ? +Number(q.fiftyDayAverage).toFixed(2) : undefined,
    ma200: q.twoHundredDayAverage != null ? +Number(q.twoHundredDayAverage).toFixed(2) : undefined,
    eps: q.epsTrailingTwelveMonths != null ? +Number(q.epsTrailingTwelveMonths).toFixed(2) : undefined,
    epsForward: q.epsForward != null ? +Number(q.epsForward).toFixed(2) : undefined,
    priceToBook: q.priceToBook != null ? +Number(q.priceToBook).toFixed(2) : undefined,
    beta: q.beta != null ? +Number(q.beta).toFixed(2) : undefined,
    isIndex: indexSymbols.has(q.symbol ?? "")
  };
}

async function fetchDetailedQuotesBatch(symbols: string[], indexSymbols: Set<string>): Promise<StockQuoteResponse[]> {
  const params = { symbols: symbols.join(","), fields: YAHOO_FIELDS };
  let result: YahooDetailedQuote[] = [];
  try {
    const response = await axios.get<{ quoteResponse?: { result?: YahooDetailedQuote[] } }>(
      "https://query1.finance.yahoo.com/v7/finance/quote",
      { params, timeout: 10000, headers: YAHOO_REQUEST_HEADERS }
    );
    result = response.data.quoteResponse?.result ?? [];
  } catch {
    const response = await axios.get<{ quoteResponse?: { result?: YahooDetailedQuote[] } }>(
      "https://query2.finance.yahoo.com/v7/finance/quote",
      { params, timeout: 10000, headers: YAHOO_REQUEST_HEADERS }
    );
    result = response.data.quoteResponse?.result ?? [];
  }
  return result.map((q) => mapDetailedQuote(q, indexSymbols));
}

async function fetchDetailedQuotes(symbols: string[], countryCode: string): Promise<StockQuoteResponse[]> {
  const indexSymbols = new Set(getIndexSymbolsForCountry(countryCode));
  const BATCH = 20;
  const batches: string[][] = [];
  for (let i = 0; i < symbols.length; i += BATCH) batches.push(symbols.slice(i, i + BATCH));

  const settled = await Promise.allSettled(
    batches.map((b) => fetchDetailedQuotesBatch(b, indexSymbols).catch(() => [] as StockQuoteResponse[]))
  );
  const all = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!all.length) throw new Error("No quote data returned");
  return all;
}

// ─── History fetch ────────────────────────────────────────────────────────────
async function fetchHistory(ticker: string): Promise<MarketHistoryResponse> {
  const chartParams = { range: "1mo", interval: "1d", includePrePost: false };
  let rawData: unknown;
  try {
    const response = await axios.get(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`,
      { params: chartParams, timeout: 8000, headers: YAHOO_REQUEST_HEADERS }
    );
    rawData = response.data;
  } catch {
    const response = await axios.get(
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`,
      { params: chartParams, timeout: 8000, headers: YAHOO_REQUEST_HEADERS }
    );
    rawData = response.data;
  }
  const result = (rawData as { chart?: { result?: unknown[] } })?.chart?.result?.[0] as {
    meta?: { symbol?: string; shortName?: string; longName?: string; currency?: string };
    timestamp?: number[];
    indicators?: { quote?: Array<{ close?: Array<number | null> }> };
  } | undefined;
  const meta = result?.meta;
  const timestamps = result?.timestamp as number[] | undefined;
  const closes = result?.indicators?.quote?.[0]?.close as Array<number | null> | undefined;
  if (!meta || !timestamps?.length || !closes?.length) throw new Error("No chart data");

  const points = timestamps
    .map((ts, i) => {
      const close = closes[i];
      if (typeof close !== "number" || !Number.isFinite(close)) return null;
      return { date: new Date(ts * 1000).toISOString(), close: +close.toFixed(2) };
    })
    .filter((p): p is MarketHistoryPoint => p !== null)
    .slice(-30);

  if (points.length < 5) throw new Error("Insufficient history");
  const series = points.map((p) => p.close);
  const latestClose = series[series.length - 1];
  const firstClose = series[0];
  return {
    symbol: meta.symbol ?? ticker, name: meta.shortName ?? meta.longName ?? ticker,
    currency: meta.currency ?? "USD", points,
    latestClose: +latestClose.toFixed(2),
    changePercent30d: +(((latestClose - firstClose) / firstClose) * 100).toFixed(2),
    high30d: +Math.max(...series).toFixed(2),
    low30d: +Math.min(...series).toFixed(2),
    source: "yahoo"
  };
}

// ─── Candle (OHLC) fetch — powers advanced charting (candlesticks, RSI, MACD, BBands) ───
type Candle = { date: string; open: number; high: number; low: number; close: number; volume: number };
type CandlesResponse = {
  symbol: string;
  name: string;
  currency: string;
  range: string;
  interval: string;
  candles: Candle[];
  source: "yahoo";
};

const ALLOWED_CANDLE_RANGES: Record<string, string> = {
  "1mo": "1d", "3mo": "1d", "6mo": "1d", "1y": "1d", "2y": "1wk", "5y": "1wk",
};

async function fetchCandles(ticker: string, range: string): Promise<CandlesResponse> {
  const interval = ALLOWED_CANDLE_RANGES[range] ?? "1d";
  const chartParams = { range, interval, includePrePost: false };
  let rawData: unknown;
  try {
    const response = await axios.get(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`,
      { params: chartParams, timeout: 9000, headers: YAHOO_REQUEST_HEADERS }
    );
    rawData = response.data;
  } catch {
    const response = await axios.get(
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`,
      { params: chartParams, timeout: 9000, headers: YAHOO_REQUEST_HEADERS }
    );
    rawData = response.data;
  }

  const result = (rawData as { chart?: { result?: unknown[] } })?.chart?.result?.[0] as {
    meta?: { symbol?: string; shortName?: string; longName?: string; currency?: string };
    timestamp?: number[];
    indicators?: { quote?: Array<{ open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null>; volume?: Array<number | null> }> };
  } | undefined;

  const meta = result?.meta;
  const timestamps = result?.timestamp;
  const quote = result?.indicators?.quote?.[0];
  if (!meta || !timestamps?.length || !quote?.close?.length) throw new Error("No candle data");

  const candles: Candle[] = timestamps
    .map((ts, i) => {
      const o = quote.open?.[i];
      const h = quote.high?.[i];
      const l = quote.low?.[i];
      const c = quote.close?.[i];
      const v = quote.volume?.[i];
      if (typeof c !== "number" || !Number.isFinite(c)) return null;
      const open = typeof o === "number" && Number.isFinite(o) ? o : c;
      const high = typeof h === "number" && Number.isFinite(h) ? h : Math.max(open, c);
      const low = typeof l === "number" && Number.isFinite(l) ? l : Math.min(open, c);
      return {
        date: new Date(ts * 1000).toISOString(),
        open: +open.toFixed(2), high: +high.toFixed(2), low: +low.toFixed(2),
        close: +c.toFixed(2), volume: typeof v === "number" && Number.isFinite(v) ? v : 0,
      };
    })
    .filter((p): p is Candle => p !== null);

  if (candles.length < 10) throw new Error("Insufficient candle data");

  return {
    symbol: meta.symbol ?? ticker,
    name: meta.shortName ?? meta.longName ?? ticker,
    currency: meta.currency ?? "USD",
    range, interval, candles, source: "yahoo",
  };
}

// ─── News helpers ─────────────────────────────────────────────────────────────
const BULLISH_WORDS = ["surge", "rally", "gain", "profit", "beat", "record", "strong", "growth", "upgrade", "buy", "soar", "rise", "bull", "positive", "outperform", "boom", "breakout"];
const BEARISH_WORDS = ["fall", "drop", "miss", "loss", "decline", "sell", "crash", "weak", "downgrade", "cut", "bear", "negative", "underperform", "concern", "risk", "plunge", "slump", "recession"];

function scoreSentiment(text: string): "bullish" | "bearish" | "neutral" {
  const lower = text.toLowerCase();
  const bull = BULLISH_WORDS.filter((w) => lower.includes(w)).length;
  const bear = BEARISH_WORDS.filter((w) => lower.includes(w)).length;
  if (bull > bear) return "bullish";
  if (bear > bull) return "bearish";
  return "neutral";
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
}

function mapFinnhubNews(items: FinnhubNewsItem[]): NewsArticle[] {
  return items
    .filter(item => item.headline && item.url)
    .map(item => ({
      title: item.headline,
      description: item.summary || undefined,
      url: item.url,
      source: { name: item.source },
      publishedAt: new Date(item.datetime * 1000).toISOString(),
      sentiment: scoreSentiment(item.headline + " " + (item.summary || "")),
      imageUrl: item.image?.startsWith("http") ? item.image : undefined,
      category: item.category || undefined,
    }));
}

async function fetchGoogleNewsRSS(query: string): Promise<NewsArticle[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}+stock+market&hl=en-US&gl=US&ceid=US:en`;
  const { data: xml } = await axios.get<string>(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; rssbot/1.0)", "Accept": "application/rss+xml,text/xml" },
    responseType: "text",
    timeout: 8000
  });

  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  return items.slice(0, 20).map((item) => {
    const rawTitle = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]
      ?? item.match(/<title>(.*?)<\/title>/)?.[1] ?? "";
    const title = decodeHtmlEntities(rawTitle);
    const link = item.match(/<link>(.*?)<\/link>/)?.[1]?.trim() ?? "";
    const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? "";
    const sourceText = decodeHtmlEntities(
      item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() ?? ""
    );
    const parts = title.split(" - ");
    const headline = parts.length > 1 ? parts.slice(0, -1).join(" - ") : title;
    const sourceName = sourceText || (parts.length > 1 ? parts[parts.length - 1] : "Google News");

    return {
      title: headline.trim(),
      url: link,
      source: { name: sourceName },
      publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      sentiment: scoreSentiment(headline)
    };
  }).filter((a) => a.title.length > 0 && a.url.length > 0);
}

async function fetchYahooNewsSearch(query: string): Promise<NewsArticle[]> {
  type YahooNewsItem = { title?: string; link?: string; publisher?: string; providerPublishTime?: number };
  type YahooSearchResp = { news?: YahooNewsItem[] };

  const response = await axios.get<YahooSearchResp>(
    "https://query2.finance.yahoo.com/v1/finance/search",
    {
      params: { q: query, newsCount: 20, quotesCount: 0 },
      headers: YAHOO_REQUEST_HEADERS,
      timeout: 8000
    }
  );
  const items = response.data?.news ?? [];
  if (!items.length) throw new Error("No Yahoo news");

  return items
    .filter((n) => n.title && n.link)
    .map((n) => ({
      title: n.title!,
      url: n.link!,
      source: { name: n.publisher ?? "Yahoo Finance" },
      publishedAt: n.providerPublishTime
        ? new Date(n.providerPublishTime * 1000).toISOString()
        : new Date().toISOString(),
      sentiment: scoreSentiment(n.title ?? "")
    }));
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function isoDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

// ─── Finnhub live-quote helpers (used when Yahoo is blocked) ─────────────────
const US_STOCK_NAMES: Record<string, string> = {
  AAPL: "Apple", MSFT: "Microsoft", NVDA: "NVIDIA", AMZN: "Amazon",
  GOOGL: "Alphabet", META: "Meta Platforms", TSLA: "Tesla", "BRK-B": "Berkshire Hathaway",
  JPM: "JPMorgan Chase", LLY: "Eli Lilly", UNH: "UnitedHealth", V: "Visa",
  XOM: "Exxon Mobil", MA: "Mastercard", JNJ: "Johnson & Johnson", PG: "Procter & Gamble",
  HD: "Home Depot", COST: "Costco", ABBV: "AbbVie", MRK: "Merck",
  CVX: "Chevron", KO: "Coca-Cola", WMT: "Walmart", BAC: "Bank of America",
  PEP: "PepsiCo", CRM: "Salesforce", NFLX: "Netflix", ORCL: "Oracle",
  AMD: "AMD", GS: "Goldman Sachs", COIN: "Coinbase", PLTR: "Palantir",
  UBER: "Uber", SNOW: "Snowflake", PANW: "Palo Alto Networks", NOW: "ServiceNow",
  F: "Ford Motor", GM: "General Motors", PYPL: "PayPal", C: "Citigroup",
};

async function fetchFinnhubQuotesForSymbols(
  symbols: string[],
  countryCode: string
): Promise<StockQuoteResponse[]> {
  const indexSymbols = new Set(getIndexSymbolsForCountry(countryCode));
  const equity = symbols.filter(s => !s.startsWith("^"));
  const results = await Promise.allSettled(equity.map(s => fhQuote(s)));
  const out: StockQuoteResponse[] = [];
  results.forEach((r, i) => {
    if (r.status !== "fulfilled" || !r.value.c) return;
    const q = r.value;
    const sym = equity[i];
    const currency = countryCode === "IN" ? "INR" : countryCode === "GB" ? "GBp" : countryCode === "JP" ? "JPY" : countryCode === "CN" ? "CNY" : "USD";
    out.push({
      symbol: sym, name: US_STOCK_NAMES[sym] ?? sym,
      exchange: countryCode === "US" ? "NASDAQ/NYSE" : countryCode,
      currency, price: q.c, lastClose: q.pc,
      change: +q.d.toFixed(2), changePercent: +q.dp.toFixed(4),
      isIndex: indexSymbols.has(sym)
    });
  });
  return out;
}

// ─── Sector map for tracked symbols (powers v0.5 sector heatmap) ───────────────
const SYMBOL_SECTORS: Record<string, string> = {
  // US tech
  AAPL: "Technology", MSFT: "Technology", NVDA: "Technology", AVGO: "Technology",
  ORCL: "Technology", CRM: "Technology", ADBE: "Technology", CSCO: "Technology",
  AMD: "Technology", TXN: "Technology", QCOM: "Technology", IBM: "Technology",
  INTU: "Technology", AMAT: "Technology", LRCX: "Technology", MU: "Technology",
  NOW: "Technology", PANW: "Technology", SNOW: "Technology", PLTR: "Technology",
  ACN: "Technology",
  // Communication / Internet
  GOOGL: "Communication", META: "Communication", NFLX: "Communication",
  // Consumer
  AMZN: "Consumer Cyclical", TSLA: "Consumer Cyclical", HD: "Consumer Cyclical",
  MCD: "Consumer Cyclical", LOW: "Consumer Cyclical", UBER: "Consumer Cyclical",
  F: "Consumer Cyclical", GM: "Consumer Cyclical",
  COST: "Consumer Defensive", WMT: "Consumer Defensive", PG: "Consumer Defensive",
  KO: "Consumer Defensive", PEP: "Consumer Defensive", PM: "Consumer Defensive",
  // Financials
  "BRK-B": "Financials", JPM: "Financials", V: "Financials", MA: "Financials",
  BAC: "Financials", GS: "Financials", C: "Financials", AXP: "Financials",
  COIN: "Financials", PYPL: "Financials",
  // Healthcare
  LLY: "Healthcare", UNH: "Healthcare", JNJ: "Healthcare", ABBV: "Healthcare",
  MRK: "Healthcare", TMO: "Healthcare", ISRG: "Healthcare", AMGN: "Healthcare",
  SYK: "Healthcare", GILD: "Healthcare",
  // Energy / Industrials
  XOM: "Energy", CVX: "Energy",
  CAT: "Industrials", HON: "Industrials", ETN: "Industrials", UNP: "Industrials",
};

export function sectorForSymbol(sym: string): string {
  return SYMBOL_SECTORS[sym] ?? "Other";
}

// Reusable single-quote helper for portfolio analysis (Yahoo → Finnhub fallback).
export async function fetchQuoteForSymbol(ticker: string): Promise<StockQuoteResponse | null> {
  let countryCode = "US";
  if (ticker.endsWith(".NS") || ticker.endsWith(".BO")) countryCode = "IN";
  else if (ticker.endsWith(".L")) countryCode = "GB";
  else if (ticker.endsWith(".T")) countryCode = "JP";
  else if (ticker.endsWith(".SS") || ticker.endsWith(".SZ")) countryCode = "CN";
  const indexSymbols = new Set(getIndexSymbolsForCountry(countryCode));
  try {
    const [q] = await fetchDetailedQuotesBatch([ticker], indexSymbols);
    if (q && q.price > 0) return q;
  } catch { /* try Finnhub */ }
  if (env.finnhubKey && countryCode === "US" && !ticker.startsWith("^")) {
    try {
      const fq = await fhQuote(ticker);
      if (fq.c) {
        return {
          symbol: ticker, name: US_STOCK_NAMES[ticker] ?? ticker,
          exchange: "NASDAQ/NYSE", currency: "USD",
          price: fq.c, lastClose: fq.pc, change: +fq.d.toFixed(2),
          changePercent: +fq.dp.toFixed(4), isIndex: false,
        };
      }
    } catch { /* give up */ }
  }
  return null;
}

type SectorSummary = {
  sector: string;
  avgChangePercent: number;
  count: number;
  topGainer: { symbol: string; changePercent: number } | null;
  topLoser: { symbol: string; changePercent: number } | null;
};

type ResearchResponse = {
  asOf: string;
  countryCode: string;
  sectors: SectorSummary[];
  dividendStocks: Array<{
    symbol: string; name: string; dividendYield: number;
    price: number; changePercent: number; peRatio?: number;
  }>;
};

// Shared fetch used by both the stocks list and the research endpoint.
async function loadDetailedStocks(countryCode: string): Promise<StockQuoteResponse[]> {
  const indexSymbols = new Set(getIndexSymbolsForCountry(countryCode));
  const symbols = getTrackedSymbolsForCountry(countryCode);

  // Reuse the recent market cache first so repeated page loads do not keep
  // exhausting upstream quote budgets on deployments.
  const freshCache = await getStocksCache(countryCode);
  if (freshCache && (freshCache.stocks.length > 0 || freshCache.indices.length > 0)) {
    return [...freshCache.stocks, ...freshCache.indices];
  }

  try {
    const all = await fetchDetailedQuotes(symbols, countryCode);
    const stocks = all.filter((s) => !indexSymbols.has(s.symbol));
    const indices = all.filter((s) => indexSymbols.has(s.symbol));
    void setStocksCache(countryCode, stocks, indices);
    return all;
  } catch { /* try Finnhub / cache */ }

  // Finnhub fallback for the detected market's own symbols (works for US;
  // may return partial data for some international tickers).
  if (env.finnhubKey) {
    try {
      const equitySymbols = symbols.filter((s) => !s.startsWith("^")).slice(0, 40);
      const all = await fetchFinnhubQuotesForSymbols(equitySymbols, countryCode);
      if (all.length > 0) { void setStocksCache(countryCode, all, []); return all; }
    } catch { /* try cache / US fallback */ }
  }

  // Prefer the geo's own stale cache before degrading to a different market.
  const stale = await getStocksCache(countryCode, { allowStale: true });
  if (stale && (stale.stocks.length > 0 || stale.indices.length > 0)) {
    return [...stale.stocks, ...stale.indices];
  }

  // Last resort: when the detected market's data is blocked AND uncached, serve
  // live US large-caps via Finnhub so Markets/Screener are never empty. The
  // geolocation-based scroll strip (snapshot) keeps its own US fallback already.
  if (env.finnhubKey && countryCode !== "US") {
    try {
      const usSymbols = getTrackedSymbolsForCountry("US").filter((s) => !s.startsWith("^")).slice(0, 40);
      const all = await fetchFinnhubQuotesForSymbols(usSymbols, "US");
      if (all.length > 0) return all;
    } catch { /* nothing left */ }
  }

  return [];
}

// ─── Default geo ──────────────────────────────────────────────────────────────
const defaultGeo: GeoLocation = {
  country: "United States", countryCode: "US", timezone: NEW_YORK_TIMEZONE,
  market: {
    name: "New York Stock Exchange", code: "NYSE", timezone: NEW_YORK_TIMEZONE,
    openHour: 9, openMinute: 30, closeHour: 16, closeMinute: 0,
    openDays: [1, 2, 3, 4, 5], label: "US market"
  }
};

// ─── Controllers ──────────────────────────────────────────────────────────────
export async function getMarketSnapshotController(req: Request, res: Response) {
  const now = new Date();
  let geo = defaultGeo;
  try { geo = await getGeolocation(req); } catch { /* use default */ }

  const market = getMarketStatusForMarket(now, geo.market);
  const base = {
    asOf: now.toISOString(),
    geoLocation: { country: geo.country, countryCode: geo.countryCode, timezone: geo.timezone },
    market,
    lastTradingDayLabel: getLastTradingDayLabel(now, geo.timezone),
    featuredTickers: getFeaturedTickersForCountry(geo.countryCode),
  };

  // 1. Live Yahoo Finance
  try {
    const tickers = await fetchQuotes(getTrackedSymbolsForCountry(geo.countryCode));
    void setSnapshotCache(geo.countryCode, tickers);
    return res.status(200).json({ ...base, tickers } satisfies MarketSnapshotResponse);
  } catch { /* try Finnhub */ }

  // 2. Finnhub fallback — use live US equities when Yahoo is blocked, even for non-US geolocation
  if (env.finnhubKey) {
    try {
      const finnhubCountryCode = "US";
      const featuredSymbols = getFeaturedTickersForCountry(finnhubCountryCode).map(f => f.symbol);
      const topUS = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM", "V", "WMT"];
      const toFetch = [...new Set([...featuredSymbols, ...topUS])].filter(s => !s.startsWith("^")).slice(0, 15);
      const quotes = await fetchFinnhubQuotesForSymbols(toFetch, finnhubCountryCode);
      const tickers = quotes.map(q => ({ symbol: q.symbol, name: q.name, lastClose: q.lastClose, changePercent: q.changePercent }));
      if (tickers.length > 0) {
        void setSnapshotCache(geo.countryCode, tickers);
        return res.status(200).json({ ...base, tickers } satisfies MarketSnapshotResponse);
      }
    } catch { /* try stale cache */ }
  }

  // 3. Stale MongoDB snapshot cache (up to 4 hours old)
  const cached = await getSnapshotCache(geo.countryCode);
  if (cached) {
    return res.status(200).json({ ...base, tickers: cached } satisfies MarketSnapshotResponse);
  }

  return res.status(502).json({ error: "Market data is unavailable right now. Please try again." });
}

export async function getMarketHistoryController(req: Request, res: Response) {
  const ticker = String(req.params.ticker ?? "").trim().toUpperCase();
  if (!ticker) return res.status(400).json({ error: "Ticker is required" });
  try {
    return res.status(200).json(await fetchHistory(ticker));
  } catch {
    return res.status(502).json({ error: `Live history is unavailable for "${ticker}" right now.` });
  }
}

export async function getCandlesController(req: Request, res: Response) {
  const ticker = String(req.params.ticker ?? "").trim().toUpperCase();
  if (!ticker) return res.status(400).json({ error: "Ticker is required" });
  const rawRange = String(req.query.range ?? "6mo").toLowerCase();
  const range = ALLOWED_CANDLE_RANGES[rawRange] ? rawRange : "6mo";
  try {
    return res.status(200).json(await fetchCandles(ticker, range));
  } catch {
    return res.status(502).json({ error: `Candle data is unavailable for "${ticker}" right now.` });
  }
}

export async function getStocksController(req: Request, res: Response) {
  const now = new Date();
  let geo = defaultGeo;
  try { geo = await getGeolocation(req); } catch { /* use default */ }

  const { countryCode } = geo;
  const indexSymbols = new Set(getIndexSymbolsForCountry(countryCode));

  const all = await loadDetailedStocks(countryCode);
  if (all.length > 0) {
    const stocks = all.filter((s) => !indexSymbols.has(s.symbol));
    const indices = all.filter((s) => indexSymbols.has(s.symbol));
    return res.status(200).json({ stocks, indices, countryCode, asOf: now.toISOString() } satisfies StocksListResponse);
  }

  return res.status(502).json({ error: "Live stock data is unavailable right now." });
}

export async function getResearchController(req: Request, res: Response) {
  const now = new Date();
  let geo = defaultGeo;
  try { geo = await getGeolocation(req); } catch { /* use default */ }
  const { countryCode } = geo;
  const indexSymbols = new Set(getIndexSymbolsForCountry(countryCode));

  const all = await loadDetailedStocks(countryCode);
  const stocks = all.filter((s) => !indexSymbols.has(s.symbol));
  if (stocks.length === 0) {
    return res.status(502).json({ error: "Research data is unavailable right now." });
  }

  // ── Sector heatmap ──
  const bySector = new Map<string, StockQuoteResponse[]>();
  for (const s of stocks) {
    const sector = sectorForSymbol(s.symbol);
    const arr = bySector.get(sector) ?? [];
    arr.push(s);
    bySector.set(sector, arr);
  }

  const sectors: SectorSummary[] = Array.from(bySector.entries())
    .map(([sector, members]) => {
      const avg = members.reduce((sum, m) => sum + m.changePercent, 0) / members.length;
      const sorted = [...members].sort((a, b) => b.changePercent - a.changePercent);
      const top = sorted[0];
      const bottom = sorted[sorted.length - 1];
      return {
        sector,
        avgChangePercent: +avg.toFixed(2),
        count: members.length,
        topGainer: top ? { symbol: top.symbol, changePercent: +top.changePercent.toFixed(2) } : null,
        topLoser: bottom ? { symbol: bottom.symbol, changePercent: +bottom.changePercent.toFixed(2) } : null,
      };
    })
    .sort((a, b) => b.avgChangePercent - a.avgChangePercent);

  // ── Dividend tracker ──
  const dividendStocks = stocks
    .filter((s) => s.dividendYield != null && s.dividendYield > 0)
    .map((s) => ({
      symbol: s.symbol, name: s.name, dividendYield: s.dividendYield as number,
      price: s.price, changePercent: +s.changePercent.toFixed(2),
      ...(s.peRatio != null ? { peRatio: s.peRatio } : {}),
    }))
    .sort((a, b) => b.dividendYield - a.dividendYield)
    .slice(0, 30);

  return res.status(200).json({
    asOf: now.toISOString(), countryCode, sectors, dividendStocks,
  } satisfies ResearchResponse);
}

export async function getStockDetailController(req: Request, res: Response) {
  const ticker = String(req.params.ticker ?? "").trim().toUpperCase();
  if (!ticker) return res.status(400).json({ error: "Ticker is required" });

  let countryCode = "US";
  if (ticker.endsWith(".NS") || ticker.endsWith(".BO")) countryCode = "IN";
  else if (ticker.endsWith(".L")) countryCode = "GB";
  else if (ticker.endsWith(".T")) countryCode = "JP";
  else if (ticker.endsWith(".SS") || ticker.endsWith(".SZ")) countryCode = "CN";

  const indexSymbols = new Set(getIndexSymbolsForCountry(countryCode));
  const QUOTE_CACHE_FRESH_MS = 10 * 60 * 1000;

  // 0. Fresh per-symbol cache — avoids re-hitting rate-limited upstreams for
  //    repeat detail/brief/compare loads of the same ticker.
  try {
    const cached = await readQuoteCache(ticker);
    if (cached && Date.now() - new Date(cached.cachedAt).getTime() < QUOTE_CACHE_FRESH_MS) {
      return res.status(200).json(cached.data);
    }
  } catch { /* cache optional */ }

  // 1. Yahoo Finance detailed quote
  let quote: StockQuoteResponse | undefined;
  try {
    const [result] = await fetchDetailedQuotesBatch([ticker], indexSymbols);
    quote = result;
  } catch { /* try Finnhub */ }

  // 2. Finnhub fallback when Yahoo is blocked (US stocks only)
  if (!quote && env.finnhubKey && countryCode === "US" && !ticker.startsWith("^")) {
    try {
      const [fhQ, fhP] = await Promise.allSettled([fhQuote(ticker), fhProfile(ticker)]);
      if (fhQ.status === "fulfilled" && fhQ.value.c) {
        const q = fhQ.value;
        const p = fhP.status === "fulfilled" ? fhP.value : null;
        quote = {
          symbol: ticker,
          name: p?.name ?? US_STOCK_NAMES[ticker] ?? ticker,
          exchange: p?.exchange ?? "NASDAQ/NYSE",
          currency: p?.currency ?? "USD",
          price: q.c, lastClose: q.pc,
          change: +q.d.toFixed(2), changePercent: +q.dp.toFixed(4),
          isIndex: false
        };
      }
    } catch { /* Finnhub failed too */ }
  }

  // 3. Enrich with Finnhub metrics + profile (fills gaps from Yahoo or Finnhub quote,
  //    incl. market cap which the bare Finnhub quote lacks — powers the Compare table)
  if (quote && env.finnhubKey && countryCode === "US" && !ticker.startsWith("^")) {
    const [metricRes, profileRes] = await Promise.allSettled([fhMetrics(ticker), fhProfile(ticker)]);
    if (metricRes.status === "fulfilled") {
      const m = metricRes.value.metric;
      if (quote.high52w == null && m["52WeekHigh"] != null) quote.high52w = +Number(m["52WeekHigh"]).toFixed(2);
      if (quote.low52w == null && m["52WeekLow"] != null) quote.low52w = +Number(m["52WeekLow"]).toFixed(2);
      if (quote.beta == null && m.beta != null) quote.beta = +Number(m.beta).toFixed(2);
      if (quote.peRatio == null && m.peTTM != null) quote.peRatio = +Number(m.peTTM).toFixed(2);
      if (quote.priceToBook == null && m.pbAnnual != null) quote.priceToBook = +Number(m.pbAnnual).toFixed(2);
      if (quote.eps == null && m.epsTTM != null) quote.eps = +Number(m.epsTTM).toFixed(2);
      if (quote.dividendYield == null && m.dividendYieldIndicatedAnnual != null) {
        quote.dividendYield = +Number(m.dividendYieldIndicatedAnnual).toFixed(2);
      }
    }
    if (profileRes.status === "fulfilled") {
      const p = profileRes.value;
      // Finnhub reports marketCapitalization in millions of the listing currency.
      if (quote.marketCap == null && p.marketCapitalization) quote.marketCap = Math.round(Number(p.marketCapitalization) * 1e6);
      if ((!quote.name || quote.name === ticker) && p.name) quote.name = p.name;
      if (!quote.exchange && p.exchange) quote.exchange = p.exchange;
    }
  }

  if (quote && quote.price > 0) {
    void writeQuoteCache(ticker, quote);
    return res.status(200).json(quote);
  }

  // 4. Fallbacks when live sources are blocked/rate-limited: stale per-symbol
  //    cache, then the recently-cached batch stocks list for this market.
  try {
    const stale = await readQuoteCache(ticker);
    if (stale?.data) return res.status(200).json(stale.data);
  } catch { /* ignore */ }
  try {
    const cachedList = await readStocksCache(countryCode);
    const found = [...(cachedList?.stocks ?? []), ...(cachedList?.indices ?? [])]
      .find((s) => s.symbol.toUpperCase() === ticker);
    if (found) return res.status(200).json(found);
  } catch { /* ignore */ }

  return res.status(502).json({ error: `Live quote unavailable for "${ticker}". Please try again.` });
}

export async function searchStocksController(req: Request, res: Response) {
  const q = String(req.query.q ?? "").trim();
  if (!q || q.length < 1) return res.status(200).json({ results: [] });

  try {
    type YahooSearchQuote = {
      symbol?: string; shortname?: string; longname?: string;
      exchange?: string; exchDisp?: string; quoteType?: string; typeDisp?: string;
    };
    const response = await axios.get<{ quotes?: YahooSearchQuote[] }>(
      "https://query2.finance.yahoo.com/v1/finance/search",
      {
        params: { q, quotesCount: 10, newsCount: 0, listsCount: 0, enableFuzzyQuery: false },
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 6000
      }
    );

    const quotes = (response.data?.quotes ?? [])
      .filter((r) => r.symbol && (r.quoteType === "EQUITY" || r.quoteType === "ETF" || r.quoteType === "INDEX"))
      .map((r) => ({
        symbol: r.symbol!,
        name: r.shortname ?? r.longname ?? r.symbol!,
        exchange: r.exchDisp ?? r.exchange ?? "",
        type: r.typeDisp ?? r.quoteType ?? "Equity"
      }));

    return res.status(200).json({ results: quotes });
  } catch {
    return res.status(200).json({ results: [] });
  }
}

export async function getNewsController(req: Request, res: Response) {
  const ticker = String(req.query.ticker ?? "").trim().toUpperCase();
  const rawCategory = String(req.query.category ?? "general").toLowerCase();
  const category = (["general", "forex", "crypto", "merger"].includes(rawCategory)
    ? rawCategory
    : "general") as "general" | "forex" | "crypto" | "merger";

  // 1. Finnhub (primary — rich data with images and summaries)
  if (env.finnhubKey) {
    try {
      const now = new Date();
      const from = isoDate(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
      const to = isoDate(now);

      const items = ticker
        ? await fhCompanyNews(ticker, from, to)
        : await fhMarketNews(category);

      if (items.length > 0) {
        const articles = mapFinnhubNews(items.slice(0, 30));
        if (articles.length > 0) {
          return res.status(200).json({ articles, source: "finnhub", ticker: ticker || null });
        }
      }
    } catch (e) {
      console.warn("Finnhub news failed:", e instanceof Error ? e.message : e);
    }
  }

  // 2. Google News RSS (fallback)
  const query = ticker || `stock market ${category !== "general" ? category : "investing"}`;
  try {
    const articles = await fetchGoogleNewsRSS(query);
    if (articles.length > 0) {
      return res.status(200).json({ articles, source: "google-news", ticker: ticker || null });
    }
  } catch (e) {
    console.warn("Google News RSS failed:", e instanceof Error ? e.message : e);
  }

  // 3. Yahoo Finance news (last resort)
  try {
    const articles = await fetchYahooNewsSearch(query);
    return res.status(200).json({ articles, source: "yahoo", ticker: ticker || null });
  } catch (e) {
    console.warn("Yahoo Finance news failed:", e instanceof Error ? e.message : e);
  }

  return res.status(200).json({ articles: [], source: "unavailable", ticker: ticker || null });
}

export async function getEarningsController(_req: Request, res: Response) {
  const now = new Date();
  const todayStr = isoDate(now);
  const futureStr = isoDate(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000));
  const pastStr = isoDate(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));

  try {
    const [upcomingRes, recentRes] = await Promise.all([
      fhEarnings(todayStr, futureStr),
      fhEarnings(pastStr, todayStr),
    ]);

    return res.status(200).json({
      upcoming: upcomingRes.earningsCalendar
        .filter(e => e.symbol && e.company)
        .slice(0, 100),
      recent: recentRes.earningsCalendar
        .filter(e => e.symbol && e.company && (e.epsActual != null || e.epsEstimate != null))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 50),
    });
  } catch (e) {
    console.error("Earnings calendar failed:", e instanceof Error ? e.message : e);
    return res.status(502).json({ error: "Earnings calendar is unavailable right now." });
  }
}

export async function getIpoCalendarController(_req: Request, res: Response) {
  const now = new Date();
  const from = isoDate(now);
  const to = isoDate(new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000));

  try {
    const result = await fhIpo(from, to);
    return res.status(200).json({
      ipos: result.ipoCalendar
        .filter(ipo => ipo.name)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    });
  } catch (e) {
    console.error("IPO calendar failed:", e instanceof Error ? e.message : e);
    return res.status(502).json({ error: "IPO calendar is unavailable right now." });
  }
}

export async function getRecommendationsController(req: Request, res: Response) {
  const ticker = String(req.params.ticker ?? "").trim().toUpperCase();
  if (!ticker) return res.status(400).json({ error: "Ticker is required" });

  try {
    const recs = await fhRecommendations(ticker);
    return res.status(200).json({ recommendations: recs.slice(0, 4) });
  } catch (e) {
    console.error("Recommendations failed:", e instanceof Error ? e.message : e);
    return res.status(502).json({ error: "Analyst recommendations unavailable." });
  }
}
