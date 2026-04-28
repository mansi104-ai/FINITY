import axios from "axios";
import type { Request, Response } from "express";
import {
  getGeolocation,
  type StockMarket,
  type GeoLocation
} from "../utils/geolocation";

const NEW_YORK_TIMEZONE = "America/New_York";
const COUNTRY_TRACKED_SYMBOLS: Record<string, string[]> = {
  IN: ["^NSEI", "^BSESN", "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS", "SBIN.NS"],
  US: ["^GSPC", "^DJI", "^IXIC", "AAPL", "MSFT", "NVDA", "AMZN", "TSLA"],
  GB: ["^FTSE", "SHEL.L", "AZN.L", "HSBA.L", "BP.L", "ULVR.L"],
  JP: ["^N225", "7203.T", "6758.T", "9984.T", "6501.T", "8306.T"],
  CN: ["000001.SS", "399001.SZ", "600519.SS", "601318.SS", "600036.SS", "601888.SS"]
};

type YahooQuote = {
  symbol?: string;
  shortName?: string;
  regularMarketPrice?: number;
  regularMarketPreviousClose?: number;
  regularMarketChangePercent?: number;
};

type MarketSnapshotResponse = {
  asOf: string;
  geoLocation: {
    country: string;
    countryCode: string;
    timezone: string;
  };
  market: {
    isOpen: boolean;
    phase: "open" | "closed";
    label: string;
    timezone: string;
    sessionHours: string;
    market: string;
  };
  lastTradingDayLabel: string;
  featuredTickers: Array<{
    symbol: string;
    name: string;
    exchange: string;
    reason: string;
  }>;
  tickers: Array<{
    symbol: string;
    name: string;
    lastClose: number;
    changePercent: number;
  }>;
};

type MarketHistoryPoint = {
  date: string;
  close: number;
};

type MarketHistoryResponse = {
  symbol: string;
  name: string;
  currency: string;
  points: MarketHistoryPoint[];
  latestClose: number;
  changePercent30d: number;
  high30d: number;
  low30d: number;
  source: "yahoo" | "synthetic";
};

const COUNTRY_FEATURED_TICKERS: Record<
  string,
  Array<{
    symbol: string;
    name: string;
    exchange: string;
    reason: string;
  }>
> = {
  IN: [
    { symbol: "RELIANCE.NS", name: "Reliance Industries", exchange: "NSE", reason: "Energy, telecom, and retail exposure for Indian large-cap investors." },
    { symbol: "TCS.NS", name: "Tata Consultancy Services", exchange: "NSE", reason: "A core Indian IT bellwether with global services revenue." },
    { symbol: "HDFCBANK.NS", name: "HDFC Bank", exchange: "NSE", reason: "A widely tracked private bank tied to domestic credit growth." }
  ],
  US: [
    { symbol: "AAPL", name: "Apple", exchange: "NASDAQ", reason: "A mega-cap technology name often used as a baseline US quality stock." },
    { symbol: "MSFT", name: "Microsoft", exchange: "NASDAQ", reason: "Cloud and AI exposure with strong balance-sheet quality." },
    { symbol: "NVDA", name: "NVIDIA", exchange: "NASDAQ", reason: "One of the highest-conviction AI infrastructure names in the US market." }
  ],
  GB: [
    { symbol: "SHEL.L", name: "Shell", exchange: "LSE", reason: "A major UK-listed global energy company." },
    { symbol: "AZN.L", name: "AstraZeneca", exchange: "LSE", reason: "A flagship UK healthcare and pharma stock." },
    { symbol: "HSBA.L", name: "HSBC", exchange: "LSE", reason: "A large international bank commonly followed by UK investors." }
  ],
  JP: [
    { symbol: "7203.T", name: "Toyota Motor", exchange: "TSE", reason: "A core Japanese industrial and auto exporter." },
    { symbol: "6758.T", name: "Sony Group", exchange: "TSE", reason: "Broad Japanese consumer tech and entertainment exposure." },
    { symbol: "9984.T", name: "SoftBank Group", exchange: "TSE", reason: "A high-beta Japanese name linked to technology investing." }
  ],
  CN: [
    { symbol: "600519.SS", name: "Kweichow Moutai", exchange: "SSE", reason: "A flagship mainland consumer stock with strong domestic recognition." },
    { symbol: "601318.SS", name: "Ping An Insurance", exchange: "SSE", reason: "A major Chinese financial services name." },
    { symbol: "600036.SS", name: "China Merchants Bank", exchange: "SSE", reason: "A frequently followed banking stock in China." }
  ]
};

function getFeaturedTickersForCountry(countryCode: string) {
  return COUNTRY_FEATURED_TICKERS[countryCode] ?? COUNTRY_FEATURED_TICKERS.US;
}

function getTrackedSymbolsForCountry(countryCode: string) {
  return COUNTRY_TRACKED_SYMBOLS[countryCode] ?? COUNTRY_TRACKED_SYMBOLS.US;
}

function getMarketStatusForMarket(now: Date, market: StockMarket) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: market.timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(now);

  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");

  const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  const minutesFromMidnight = hour * 60 + minute;
  const openMinutes = market.openHour * 60 + market.openMinute;
  const closeMinutes = market.closeHour * 60 + market.closeMinute;
  const isOpenDay = market.openDays.includes(dayIndex);
  const isOpen = isOpenDay && minutesFromMidnight >= openMinutes && minutesFromMidnight < closeMinutes;

  const timeStr = `${String(market.openHour).padStart(2, "0")}:${String(market.openMinute).padStart(2, "0")} - ${String(market.closeHour).padStart(2, "0")}:${String(market.closeMinute).padStart(2, "0")}`;

  return {
    isOpen,
    phase: isOpen ? "open" : "closed",
    label: isOpen ? `${market.label} is open` : `${market.label} is closed`,
    timezone: market.timezone,
    sessionHours: timeStr,
    market: market.code
  } as const;
}

function getNewYorkParts(now: Date): { weekday: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NEW_YORK_TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(now);

  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");

  return { weekday, hour, minute };
}

function getLastTradingDayLabel(now: Date, timezone: string = NEW_YORK_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "numeric",
    weekday: "short"
  }).formatToParts(now);

  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Mon";
  const month = parts.find((part) => part.type === "month")?.value ?? "Jan";
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "1");
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "2026");

  const currentWeekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  const date = new Date(Date.UTC(year, new Date(`${month} 1, ${year}`).getMonth(), day));

  let offsetDays = 1;
  if (currentWeekday === 1) {
    offsetDays = 3;
  } else if (currentWeekday === 0) {
    offsetDays = 2;
  } else if (currentWeekday === 6) {
    offsetDays = 1;
  }

  date.setUTCDate(date.getUTCDate() - offsetDays);

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric"
  }).format(date);
}

function getMarketStatus(now: Date) {
  const { weekday, hour, minute } = getNewYorkParts(now);
  const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  const minutesFromMidnight = hour * 60 + minute;
  const openMinutes = 9 * 60 + 30;
  const closeMinutes = 16 * 60;
  const isWeekday = dayIndex >= 1 && dayIndex <= 5;
  const isOpen = isWeekday && minutesFromMidnight >= openMinutes && minutesFromMidnight < closeMinutes;

  return {
    isOpen,
    phase: isOpen ? "open" : "closed",
    label: isOpen ? "US market is open" : "US market is closed",
    timezone: NEW_YORK_TIMEZONE,
    sessionHours: "9:30 AM - 4:00 PM ET",
    market: "NYSE"
  } as const;
}

function fallbackTickerData(countryCode: string): MarketSnapshotResponse["tickers"] {
  if (countryCode === "IN") {
    return [
      { symbol: "^NSEI", name: "Nifty 50", lastClose: 22463.3, changePercent: 0.58 },
      { symbol: "^BSESN", name: "Sensex", lastClose: 73902.1, changePercent: 0.52 },
      { symbol: "RELIANCE.NS", name: "Reliance Industries", lastClose: 2988.4, changePercent: 0.84 },
      { symbol: "TCS.NS", name: "Tata Consultancy Services", lastClose: 4012.3, changePercent: 0.44 },
      { symbol: "HDFCBANK.NS", name: "HDFC Bank", lastClose: 1548.6, changePercent: -0.12 },
      { symbol: "INFY.NS", name: "Infosys", lastClose: 1499.8, changePercent: 0.63 },
      { symbol: "ICICIBANK.NS", name: "ICICI Bank", lastClose: 1087.5, changePercent: 0.38 },
      { symbol: "SBIN.NS", name: "State Bank of India", lastClose: 781.2, changePercent: -0.21 }
    ];
  }

  return [
    { symbol: "^GSPC", name: "S&P 500", lastClose: 5224.62, changePercent: 0.42 },
    { symbol: "^DJI", name: "Dow Jones", lastClose: 39214.15, changePercent: 0.31 },
    { symbol: "^IXIC", name: "Nasdaq", lastClose: 16384.47, changePercent: 0.68 },
    { symbol: "AAPL", name: "Apple", lastClose: 213.48, changePercent: 0.57 },
    { symbol: "MSFT", name: "Microsoft", lastClose: 428.36, changePercent: 0.44 },
    { symbol: "NVDA", name: "NVIDIA", lastClose: 903.56, changePercent: 1.12 },
    { symbol: "AMZN", name: "Amazon", lastClose: 181.22, changePercent: -0.18 },
    { symbol: "TSLA", name: "Tesla", lastClose: 172.63, changePercent: -1.03 }
  ];
}

async function fetchQuotes(symbolsToTrack: string[]): Promise<MarketSnapshotResponse["tickers"]> {
  const symbols = symbolsToTrack.join(",");
  const response = await axios.get<{ quoteResponse?: { result?: YahooQuote[] } }>(
    "https://query1.finance.yahoo.com/v7/finance/quote",
    {
      params: { symbols },
      timeout: 6000
    }
  );

  const result = response.data.quoteResponse?.result ?? [];
  if (!result.length) {
    throw new Error("No quote data returned");
  }

  return result.map((quote) => ({
    symbol: quote.symbol ?? "N/A",
    name: quote.shortName ?? quote.symbol ?? "Ticker",
    lastClose: Number(quote.regularMarketPreviousClose ?? quote.regularMarketPrice ?? 0),
    changePercent: Number(quote.regularMarketChangePercent ?? 0)
  }));
}

function syntheticHistory(ticker: string, baseline = 1500): MarketHistoryResponse {
  const seed = ticker.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const points: MarketHistoryPoint[] = [];
  let current = baseline + (seed % 300);
  const today = new Date();

  for (let index = 29; index >= 0; index -= 1) {
    const drift = ((seed % 7) - 3) * 0.0009;
    const wave = Math.sin((29 - index + seed) / 4.2) * 0.009;
    current = Math.max(10, current * (1 + drift + wave));
    const date = new Date(today);
    date.setDate(today.getDate() - index);
    points.push({
      date: date.toISOString(),
      close: Number(current.toFixed(2))
    });
  }

  const closes = points.map((point) => point.close);
  const latestClose = closes[closes.length - 1];
  const firstClose = closes[0];

  return {
    symbol: ticker,
    name: ticker,
    currency: "INR",
    points,
    latestClose,
    changePercent30d: Number((((latestClose - firstClose) / firstClose) * 100).toFixed(2)),
    high30d: Number(Math.max(...closes).toFixed(2)),
    low30d: Number(Math.min(...closes).toFixed(2)),
    source: "synthetic"
  };
}

async function fetchHistory(ticker: string): Promise<MarketHistoryResponse> {
  const response = await axios.get("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(ticker), {
    params: {
      range: "1mo",
      interval: "1d",
      includePrePost: false,
      events: "div,splits"
    },
    timeout: 6000
  });

  const result = response.data?.chart?.result?.[0];
  const meta = result?.meta;
  const timestamps = result?.timestamp as number[] | undefined;
  const closes = result?.indicators?.quote?.[0]?.close as Array<number | null> | undefined;

  if (!meta || !timestamps?.length || !closes?.length) {
    throw new Error("No chart history returned");
  }

  const points = timestamps
    .map((timestamp, index) => {
      const close = closes[index];
      if (typeof close !== "number" || !Number.isFinite(close)) {
        return null;
      }
      return {
        date: new Date(timestamp * 1000).toISOString(),
        close: Number(close.toFixed(2))
      };
    })
    .filter((point): point is MarketHistoryPoint => point !== null)
    .slice(-30);

  if (points.length < 10) {
    throw new Error("Insufficient chart history returned");
  }

  const series = points.map((point) => point.close);
  const latestClose = series[series.length - 1];
  const firstClose = series[0];

  return {
    symbol: meta.symbol ?? ticker,
    name: meta.shortName ?? meta.longName ?? meta.symbol ?? ticker,
    currency: meta.currency ?? "INR",
    points,
    latestClose: Number(latestClose.toFixed(2)),
    changePercent30d: Number((((latestClose - firstClose) / firstClose) * 100).toFixed(2)),
    high30d: Number(Math.max(...series).toFixed(2)),
    low30d: Number(Math.min(...series).toFixed(2)),
    source: "yahoo"
  };
}

export async function getMarketSnapshotController(req: Request, res: Response) {
  const now = new Date();
  const defaultGeo: GeoLocation = {
    country: "United States",
    countryCode: "US",
    timezone: NEW_YORK_TIMEZONE,
    market: {
      name: "New York Stock Exchange",
      code: "NYSE",
      timezone: NEW_YORK_TIMEZONE,
      openHour: 9,
      openMinute: 30,
      closeHour: 16,
      closeMinute: 0,
      openDays: [1, 2, 3, 4, 5],
      label: "US market"
    }
  };
  let geo = defaultGeo;

  try {
    geo = await getGeolocation(req);
    
    const market = getMarketStatusForMarket(now, geo.market);
    const tickers = await fetchQuotes(getTrackedSymbolsForCountry(geo.countryCode));
    return res.status(200).json({
      asOf: now.toISOString(),
      geoLocation: {
        country: geo.country,
        countryCode: geo.countryCode,
        timezone: geo.timezone
      },
      market,
      lastTradingDayLabel: getLastTradingDayLabel(now, geo.timezone),
      featuredTickers: getFeaturedTickersForCountry(geo.countryCode),
      tickers
    } satisfies MarketSnapshotResponse);
  } catch (error) {
    console.warn("Falling back to static market snapshot", error);
    const market = getMarketStatusForMarket(now, geo.market);
    return res.status(200).json({
      asOf: now.toISOString(),
      geoLocation: {
        country: geo.country,
        countryCode: geo.countryCode,
        timezone: geo.timezone
      },
      market,
      lastTradingDayLabel: getLastTradingDayLabel(now, geo.timezone),
      featuredTickers: getFeaturedTickersForCountry(geo.countryCode),
      tickers: fallbackTickerData(geo.countryCode)
    } satisfies MarketSnapshotResponse);
  }
}

export async function getMarketHistoryController(req: Request, res: Response) {
  const ticker = String(req.params.ticker ?? "").trim().toUpperCase();

  if (!ticker) {
    return res.status(400).json({ error: "Ticker is required" });
  }

  try {
    const history = await fetchHistory(ticker);
    return res.status(200).json(history satisfies MarketHistoryResponse);
  } catch (error) {
    console.warn(`Falling back to synthetic 30-day history for ${ticker}`, error);
    return res.status(200).json(syntheticHistory(ticker) satisfies MarketHistoryResponse);
  }
}
