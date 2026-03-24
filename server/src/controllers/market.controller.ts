import axios from "axios";
import type { Request, Response } from "express";
import {
  getClientIp,
  getGeolocationFromIP,
  getMarketFromTimezone,
  type StockMarket,
  type GeoLocation
} from "../utils/geolocation";

const TRACKED_SYMBOLS = ["^GSPC", "^DJI", "^IXIC", "AAPL", "MSFT", "NVDA", "AMZN", "TSLA"] as const;
const NEW_YORK_TIMEZONE = "America/New_York";

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
  tickers: Array<{
    symbol: string;
    name: string;
    lastClose: number;
    changePercent: number;
  }>;
};

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
    sessionHours: "9:30 AM - 4:00 PM ET"
  } as const;
}

function fallbackTickerData(): MarketSnapshotResponse["tickers"] {
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

async function fetchQuotes(): Promise<MarketSnapshotResponse["tickers"]> {
  const symbols = TRACKED_SYMBOLS.join(",");
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

export async function getMarketSnapshotController(req: Request, res: Response) {
  const now = new Date();

  try {
    // Get user's IP and determine their location
    const clientIp = getClientIp(req);
    const geo = await getGeolocationFromIP(clientIp);
    
    // Get market status based on user's location
    const market = getMarketStatusForMarket(now, geo.market);
    
    const tickers = await fetchQuotes();
    return res.status(200).json({
      asOf: now.toISOString(),
      geoLocation: {
        country: geo.country,
        countryCode: geo.countryCode,
        timezone: geo.timezone
      },
      market,
      lastTradingDayLabel: getLastTradingDayLabel(now, geo.timezone),
      tickers
    } satisfies MarketSnapshotResponse);
  } catch (error) {
    console.warn("Falling back to static market snapshot", error);
    const market = getMarketStatus(now);
    return res.status(200).json({
      asOf: now.toISOString(),
      geoLocation: {
        country: "United States",
        countryCode: "US",
        timezone: NEW_YORK_TIMEZONE
      },
      market,
      lastTradingDayLabel: getLastTradingDayLabel(now),
      tickers: fallbackTickerData()
    } satisfies MarketSnapshotResponse);
  }
}
