import axios from "axios";
import type { Request, Response } from "express";
import {
  getGeolocation,
  type StockMarket,
  type GeoLocation
} from "../utils/geolocation";
import { env } from "../config";
import { getDb } from "../store/db";

const NEW_YORK_TIMEZONE = "America/New_York";
const STOCK_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const YAHOO_REQUEST_HEADERS = { "User-Agent": "Mozilla/5.0" };

// ─── Expanded tracked symbols ─────────────────────────────────────────────────
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
  source: "yahoo" | "synthetic";
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
};

// ─── MongoDB stock cache ───────────────────────────────────────────────────────
async function getStocksCache(
  countryCode: string,
  options: { allowStale?: boolean } = {}
): Promise<{ stocks: StockQuoteResponse[]; indices: StockQuoteResponse[] } | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const doc = await db.collection("stocks_cache").findOne({ countryCode });
    if (!doc) return null;
    const age = Date.now() - new Date(doc.cachedAt as string).getTime();
    if (!options.allowStale && age > STOCK_CACHE_TTL_MS) return null;
    return { stocks: doc.stocks as StockQuoteResponse[], indices: doc.indices as StockQuoteResponse[] };
  } catch {
    return null;
  }
}

async function setStocksCache(countryCode: string, stocks: StockQuoteResponse[], indices: StockQuoteResponse[]): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.collection("stocks_cache").updateOne(
      { countryCode },
      { $set: { countryCode, stocks, indices, cachedAt: new Date().toISOString() } },
      { upsert: true }
    );
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

// ─── Fallback data ────────────────────────────────────────────────────────────
function fallbackTickerData(countryCode: string): MarketSnapshotResponse["tickers"] {
  if (countryCode === "IN") return [
    { symbol: "^NSEI", name: "Nifty 50", lastClose: 22463, changePercent: 0.58 },
    { symbol: "^BSESN", name: "Sensex", lastClose: 73902, changePercent: 0.52 },
    { symbol: "RELIANCE.NS", name: "Reliance Industries", lastClose: 2988, changePercent: 0.84 },
    { symbol: "TCS.NS", name: "TCS", lastClose: 4012, changePercent: 0.44 },
    { symbol: "HDFCBANK.NS", name: "HDFC Bank", lastClose: 1548, changePercent: -0.12 },
    { symbol: "INFY.NS", name: "Infosys", lastClose: 1499, changePercent: 0.63 },
  ];
  return [
    { symbol: "^GSPC", name: "S&P 500", lastClose: 5224, changePercent: 0.42 },
    { symbol: "^DJI", name: "Dow Jones", lastClose: 39214, changePercent: 0.31 },
    { symbol: "^IXIC", name: "Nasdaq", lastClose: 16384, changePercent: 0.68 },
    { symbol: "AAPL", name: "Apple", lastClose: 213, changePercent: 0.57 },
    { symbol: "MSFT", name: "Microsoft", lastClose: 428, changePercent: 0.44 },
    { symbol: "NVDA", name: "NVIDIA", lastClose: 903, changePercent: 1.12 },
    { symbol: "AMZN", name: "Amazon", lastClose: 181, changePercent: -0.18 },
    { symbol: "TSLA", name: "Tesla", lastClose: 172, changePercent: -1.03 },
  ];
}

function fallbackStockData(countryCode: string): StockQuoteResponse[] {
  const indexSymbols = new Set(getIndexSymbolsForCountry(countryCode));
  return fallbackTickerData(countryCode).map((t) => ({
    symbol: t.symbol, name: t.name,
    exchange: countryCode === "IN" ? "NSE/BSE" : "NYSE/NASDAQ",
    currency: countryCode === "IN" ? "INR" : countryCode === "GB" ? "GBp" : "USD",
    price: t.lastClose, lastClose: t.lastClose,
    change: +(t.lastClose * t.changePercent / 100).toFixed(2),
    changePercent: t.changePercent, isIndex: indexSymbols.has(t.symbol)
  }));
}

// ─── Yahoo Finance fetch helpers ──────────────────────────────────────────────
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
  const response = await axios.get<{ quoteResponse?: { result?: YahooDetailedQuote[] } }>(
    "https://query1.finance.yahoo.com/v7/finance/quote",
    { params: { symbols: symbols.join(","), fields: YAHOO_FIELDS }, timeout: 10000, headers: YAHOO_REQUEST_HEADERS }
  );
  const result = response.data.quoteResponse?.result ?? [];
  return result.map((q) => mapDetailedQuote(q, indexSymbols));
}

// Batch into groups of 20 to avoid Yahoo Finance limits
async function fetchDetailedQuotes(symbols: string[], countryCode: string): Promise<StockQuoteResponse[]> {
  const indexSymbols = new Set(getIndexSymbolsForCountry(countryCode));
  const BATCH = 20;
  const batches: string[][] = [];
  for (let i = 0; i < symbols.length; i += BATCH) batches.push(symbols.slice(i, i + BATCH));

  const results = await Promise.all(
    batches.map((b) => fetchDetailedQuotesBatch(b, indexSymbols).catch(() => [] as StockQuoteResponse[]))
  );
  const all = results.flat();
  if (!all.length) throw new Error("No quote data returned");
  return all;
}

// ─── History fetch ────────────────────────────────────────────────────────────
function syntheticHistory(ticker: string, baseline = 1500): MarketHistoryResponse {
  const seed = ticker.split("").reduce((sum, c) => sum + c.charCodeAt(0), 0);
  const points: MarketHistoryPoint[] = [];
  let current = baseline + (seed % 300);
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const drift = ((seed % 7) - 3) * 0.0009;
    const wave = Math.sin((29 - i + seed) / 4.2) * 0.009;
    current = Math.max(10, current * (1 + drift + wave));
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    points.push({ date: date.toISOString(), close: +current.toFixed(2) });
  }
  const closes = points.map((p) => p.close);
  const latestClose = closes[closes.length - 1];
  const firstClose = closes[0];
  return {
    symbol: ticker, name: ticker, currency: "USD", points, latestClose,
    changePercent30d: +(((latestClose - firstClose) / firstClose) * 100).toFixed(2),
    high30d: +Math.max(...closes).toFixed(2),
    low30d: +Math.min(...closes).toFixed(2),
    source: "synthetic"
  };
}

async function fetchHistory(ticker: string): Promise<MarketHistoryResponse> {
  const response = await axios.get(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`,
    { params: { range: "1mo", interval: "1d", includePrePost: false }, timeout: 8000, headers: YAHOO_REQUEST_HEADERS }
  );
  const result = response.data?.chart?.result?.[0];
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

  if (points.length < 10) throw new Error("Insufficient history");
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

// Google News RSS — no API key, reliable from any server
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
    // Google News titles: "Headline text - Source Name"
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

// Yahoo Finance search news — fallback
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
  try {
    geo = await getGeolocation(req);
    const market = getMarketStatusForMarket(now, geo.market);
    const tickers = await fetchQuotes(getTrackedSymbolsForCountry(geo.countryCode));
    return res.status(200).json({
      asOf: now.toISOString(),
      geoLocation: { country: geo.country, countryCode: geo.countryCode, timezone: geo.timezone },
      market, lastTradingDayLabel: getLastTradingDayLabel(now, geo.timezone),
      featuredTickers: getFeaturedTickersForCountry(geo.countryCode), tickers
    } satisfies MarketSnapshotResponse);
  } catch {
    const market = getMarketStatusForMarket(now, geo.market);
    return res.status(200).json({
      asOf: now.toISOString(),
      geoLocation: { country: geo.country, countryCode: geo.countryCode, timezone: geo.timezone },
      market, lastTradingDayLabel: getLastTradingDayLabel(now, geo.timezone),
      featuredTickers: getFeaturedTickersForCountry(geo.countryCode),
      tickers: fallbackTickerData(geo.countryCode)
    } satisfies MarketSnapshotResponse);
  }
}

export async function getMarketHistoryController(req: Request, res: Response) {
  const ticker = String(req.params.ticker ?? "").trim().toUpperCase();
  if (!ticker) return res.status(400).json({ error: "Ticker is required" });
  try {
    return res.status(200).json(await fetchHistory(ticker));
  } catch {
    return res.status(200).json(syntheticHistory(ticker));
  }
}

export async function getStocksController(req: Request, res: Response) {
  const now = new Date();
  let geo = defaultGeo;
  try { geo = await getGeolocation(req); } catch { /* use default */ }

  const { countryCode } = geo;
  const indexSymbols = new Set(getIndexSymbolsForCountry(countryCode));

  // 1. Try MongoDB cache
  const cached = await getStocksCache(countryCode);
  if (cached) {
    return res.status(200).json({ ...cached, countryCode, asOf: now.toISOString() } satisfies StocksListResponse);
  }

  // 2. Fetch fresh from Yahoo Finance
  const symbols = getTrackedSymbolsForCountry(countryCode);
  try {
    const all = await fetchDetailedQuotes(symbols, countryCode);
    const stocks = all.filter((s) => !indexSymbols.has(s.symbol));
    const indices = all.filter((s) => indexSymbols.has(s.symbol));
    void setStocksCache(countryCode, stocks, indices); // cache async
    return res.status(200).json({ stocks, indices, countryCode, asOf: now.toISOString() } satisfies StocksListResponse);
  } catch {
    // 3. Fall back to stale cache before using static data
    const staleCache = await getStocksCache(countryCode, { allowStale: true });
    if (staleCache) {
      return res.status(200).json({ ...staleCache, countryCode, asOf: now.toISOString() } satisfies StocksListResponse);
    }

    // 4. Fallback to static data
    const fallback = fallbackStockData(countryCode);
    return res.status(200).json({
      stocks: fallback.filter((s) => !indexSymbols.has(s.symbol)),
      indices: fallback.filter((s) => indexSymbols.has(s.symbol)),
      countryCode, asOf: now.toISOString()
    } satisfies StocksListResponse);
  }
}

export async function getStockDetailController(req: Request, res: Response) {
  const ticker = String(req.params.ticker ?? "").trim().toUpperCase();
  if (!ticker) return res.status(400).json({ error: "Ticker is required" });

  let countryCode = "US";
  if (ticker.endsWith(".NS") || ticker.endsWith(".BO")) countryCode = "IN";
  else if (ticker.endsWith(".L")) countryCode = "GB";
  else if (ticker.endsWith(".T")) countryCode = "JP";
  else if (ticker.endsWith(".SS") || ticker.endsWith(".SZ")) countryCode = "CN";

  try {
    const indexSymbols = new Set(getIndexSymbolsForCountry(countryCode));
    const [result] = await fetchDetailedQuotesBatch([ticker], indexSymbols);
    if (!result) return res.status(404).json({ error: "Symbol not found" });
    return res.status(200).json(result);
  } catch {
    const trackedSymbols = getTrackedSymbolsForCountry(countryCode);
    const isTrackedSymbol = trackedSymbols.includes(ticker);
    const indexSymbols = new Set(getIndexSymbolsForCountry(countryCode));

    if (isTrackedSymbol) {
      const cached = await getStocksCache(countryCode);
      const cachedMatch = cached
        ? [...cached.stocks, ...cached.indices].find((stock) => stock.symbol.toUpperCase() === ticker)
        : undefined;
      if (cachedMatch) {
        return res.status(200).json(cachedMatch);
      }
    }

    const fallbackMatch = fallbackStockData(countryCode).find((stock) => stock.symbol.toUpperCase() === ticker);
    if (fallbackMatch) {
      return res.status(200).json(fallbackMatch);
    }

    try {
      const history = await fetchHistory(ticker);
      const latestClose = history.latestClose;
      const firstClose = history.points[0]?.close ?? latestClose;
      const change = +(latestClose - firstClose).toFixed(2);
      const changePercent = firstClose ? +(((latestClose - firstClose) / firstClose) * 100).toFixed(4) : 0;

      return res.status(200).json({
        symbol: history.symbol,
        name: history.name,
        exchange: "",
        currency: history.currency,
        price: latestClose,
        lastClose: firstClose,
        change,
        changePercent,
        isIndex: indexSymbols.has(history.symbol)
      } satisfies StockQuoteResponse);
    } catch {
      return res.status(404).json({ error: `Could not find data for "${ticker}". Check the ticker symbol and try again.` });
    }
  }
}

// Ticker search — supports any company name or symbol via Yahoo Finance autocomplete
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
  const query = ticker || "stock market investing";

  // 1. Try Google News RSS — works from any server, no API key needed
  try {
    const articles = await fetchGoogleNewsRSS(query);
    if (articles.length > 0) {
      return res.status(200).json({ articles, source: "google-news", ticker: ticker || null });
    }
  } catch (e) {
    console.warn("Google News RSS failed", e);
  }

  // 2. Fall back to Yahoo Finance search news
  try {
    const articles = await fetchYahooNewsSearch(query);
    return res.status(200).json({ articles, source: "yahoo", ticker: ticker || null });
  } catch (e) {
    console.warn("Yahoo Finance news failed", e);
  }

  return res.status(200).json({ articles: [], source: "unavailable", ticker: ticker || null });
}
