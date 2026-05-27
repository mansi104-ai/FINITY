import axios from "axios";
import { randomUUID } from "crypto";
import { getAllWatchlists, saveNotification } from "../store/db";
import type { NotificationRecord } from "../models/Notification.model";

const YAHOO_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

interface MarketConfig {
  countryCode: string;
  name: string;
  timezone: string;
}

const MARKETS: MarketConfig[] = [
  { countryCode: "US", name: "US Market", timezone: "America/New_York" },
  { countryCode: "IN", name: "India Market", timezone: "Asia/Kolkata" },
  { countryCode: "GB", name: "UK Market", timezone: "Europe/London" },
  { countryCode: "JP", name: "Japan Market", timezone: "Asia/Tokyo" },
  { countryCode: "CN", name: "China Market", timezone: "Asia/Shanghai" },
];

function getSymbolMarket(symbol: string): string {
  if (symbol.endsWith(".NS") || symbol.endsWith(".BO")) return "IN";
  if (symbol.endsWith(".L")) return "GB";
  if (symbol.endsWith(".T")) return "JP";
  if (symbol.endsWith(".SS") || symbol.endsWith(".SZ")) return "CN";
  return "US";
}

interface MarketTimeParts {
  hour: string;
  minute: string;
  weekday: string;
  dateKey: string;
}

function getMarketTimeParts(timezone: string): MarketTimeParts {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short"
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    hour: get("hour"),
    minute: get("minute"),
    weekday: get("weekday"),
    dateKey: `${get("year")}-${get("month")}-${get("day")}`
  };
}

async function fetchCurrentPrices(symbols: string[]): Promise<Record<string, { changePercent: number; name: string }>> {
  if (!symbols.length) return {};
  try {
    const resp = await axios.get<{ quoteResponse?: { result?: Array<{ symbol?: string; regularMarketChangePercent?: number; shortName?: string }> } }>(
      "https://query1.finance.yahoo.com/v7/finance/quote",
      { params: { symbols: symbols.join(","), fields: "regularMarketChangePercent,shortName" }, headers: YAHOO_HEADERS, timeout: 8000 }
    );
    const result = resp.data?.quoteResponse?.result ?? [];
    const out: Record<string, { changePercent: number; name: string }> = {};
    for (const q of result) {
      if (q.symbol) out[q.symbol] = { changePercent: q.regularMarketChangePercent ?? 0, name: q.shortName ?? q.symbol };
    }
    return out;
  } catch {
    return {};
  }
}

async function runDigestForMarket(market: MarketConfig): Promise<void> {
  console.log(`[digest] Running morning digest for ${market.name}`);
  try {
    const allWatchlists = await getAllWatchlists();
    if (!allWatchlists.length) return;

    for (const watchlist of allWatchlists) {
      const marketItems = watchlist.items.filter((item) => getSymbolMarket(item.ticker) === market.countryCode);
      if (!marketItems.length) continue;

      const symbols = marketItems.map((i) => i.ticker);
      const prices = await fetchCurrentPrices(symbols);

      const movers = symbols
        .map((sym) => {
          const data = prices[sym];
          if (!data) return null;
          const sign = data.changePercent >= 0 ? "+" : "";
          return `${sym} ${sign}${data.changePercent.toFixed(2)}%`;
        })
        .filter((x): x is string => x !== null);

      if (!movers.length) continue;

      const notification: NotificationRecord = {
        id: randomUUID(),
        userId: watchlist.userId,
        type: "morning_digest",
        title: `Morning Brief — ${market.name}`,
        body: movers.join("  ·  "),
        read: false,
        createdAt: new Date().toISOString()
      };

      await saveNotification(notification);
    }
  } catch (err) {
    console.error(`[digest] ${market.countryCode} error:`, err instanceof Error ? err.message : err);
  }
}

// Track last-fired date per market to prevent duplicate fires within same minute
const lastFired = new Map<string, string>();

function checkAndRunDigests(): void {
  for (const market of MARKETS) {
    const { hour, minute, weekday, dateKey } = getMarketTimeParts(market.timezone);
    if (hour === "09" && minute === "00" && weekday !== "Sat" && weekday !== "Sun") {
      if (lastFired.get(market.countryCode) !== dateKey) {
        lastFired.set(market.countryCode, dateKey);
        void runDigestForMarket(market);
      }
    }
  }
}

export function startMorningDigestJobs(): void {
  // Poll every 60 seconds — fires the digest exactly at 09:00 in each market timezone Mon-Fri
  setInterval(checkAndRunDigests, 60 * 1000);
  console.log("[digest] Morning digest scheduler started — checks every 60s for 09:00 in US/IN/GB/JP/CN");
}
