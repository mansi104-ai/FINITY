import axios from "axios";
import { randomUUID } from "crypto";
import {
  getActivePriceAlerts,
  getActivePriceAlertsForUser,
  savePriceAlert,
  saveNotification,
  getUserById,
} from "../store/db";
import type { PriceAlertRecord } from "../models/PriceAlert.model";
import type { NotificationRecord } from "../models/Notification.model";
import { sendEmail } from "./email";
import { fhQuote } from "./finnhub";
import { env } from "../config";

const YAHOO_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

/** Fetch current prices for a set of symbols (query1 → query2 fallback). */
export async function fetchLivePrices(symbols: string[]): Promise<Record<string, number>> {
  if (!symbols.length) return {};
  const params = { symbols: [...new Set(symbols)].join(","), fields: "regularMarketPrice" };
  const parse = (result: Array<{ symbol?: string; regularMarketPrice?: number }>) => {
    const out: Record<string, number> = {};
    for (const q of result) {
      if (q.symbol && typeof q.regularMarketPrice === "number") out[q.symbol] = q.regularMarketPrice;
    }
    return out;
  };
  try {
    const resp = await axios.get<{ quoteResponse?: { result?: Array<{ symbol?: string; regularMarketPrice?: number }> } }>(
      "https://query1.finance.yahoo.com/v7/finance/quote",
      { params, headers: YAHOO_HEADERS, timeout: 8000 }
    );
    const r = resp.data?.quoteResponse?.result ?? [];
    if (r.length) return parse(r);
  } catch { /* fall through */ }
  let out: Record<string, number> = {};
  try {
    const resp = await axios.get<{ quoteResponse?: { result?: Array<{ symbol?: string; regularMarketPrice?: number }> } }>(
      "https://query2.finance.yahoo.com/v7/finance/quote",
      { params, headers: YAHOO_HEADERS, timeout: 8000 }
    );
    out = parse(resp.data?.quoteResponse?.result ?? []);
  } catch { /* Yahoo blocked — fall back to Finnhub below */ }

  // Finnhub fallback for any symbols Yahoo didn't return (e.g. blocked cloud IP).
  if (env.finnhubKey) {
    const missing = [...new Set(symbols)].filter((s) => out[s] == null && !s.startsWith("^"));
    const results = await Promise.allSettled(missing.map((s) => fhQuote(s)));
    results.forEach((r, i) => {
      if (r.status === "fulfilled" && typeof r.value.c === "number" && r.value.c > 0) out[missing[i]] = r.value.c;
    });
  }

  // Yahoo v8 chart fallback — this is the only path that works on Vercel for
  // non-US tickers (Yahoo v7 above is IP-blocked, Finnhub free is US-only). It's
  // what lets India/NSE price alerts actually fire.
  const stillMissing = [...new Set(symbols)].filter((s) => out[s] == null);
  if (stillMissing.length) {
    const results = await Promise.allSettled(stillMissing.map((s) => fetchChartPrice(s)));
    results.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value != null && r.value > 0) out[stillMissing[i]] = r.value;
    });
  }
  return out;
}

/** Latest price for one symbol from Yahoo's v8 chart endpoint (works on Vercel). */
async function fetchChartPrice(symbol: string): Promise<number | null> {
  const params = { range: "1d", interval: "1d" };
  for (const host of ["query1", "query2"]) {
    try {
      const resp = await axios.get(
        `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
        { params, headers: YAHOO_HEADERS, timeout: 7000 }
      );
      const meta = (resp.data as { chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> } })
        ?.chart?.result?.[0]?.meta;
      const price = meta?.regularMarketPrice;
      if (typeof price === "number" && price > 0) return price;
    } catch { /* try next host */ }
  }
  return null;
}

function isTriggered(alert: PriceAlertRecord, price: number): boolean {
  return alert.direction === "above" ? price >= alert.threshold : price <= alert.threshold;
}

/** Evaluate a batch of alerts against fetched prices; fire + deactivate any triggered. Returns count fired. */
async function evaluateAlerts(alerts: PriceAlertRecord[]): Promise<number> {
  if (!alerts.length) return 0;
  const prices = await fetchLivePrices(alerts.map((a) => a.ticker));
  let fired = 0;

  const DAILY_THROTTLE_MS = 20 * 60 * 60 * 1000; // re-remind at most ~once/day
  for (const alert of alerts) {
    const price = prices[alert.ticker];
    if (price == null || !isTriggered(alert, price)) continue;

    const cadence = alert.cadence ?? "once";

    // For recurring "daily" alerts, don't spam — only notify if we haven't in ~20h.
    if (cadence === "daily" && alert.lastNotifiedAt) {
      const since = Date.now() - new Date(alert.lastNotifiedAt).getTime();
      if (since < DAILY_THROTTLE_MS) continue;
    }

    const now = new Date().toISOString();
    // "once" deactivates after firing; "daily" stays active for the next reminder.
    await savePriceAlert({
      ...alert,
      active: cadence === "daily",
      triggeredAt: now,
      triggeredPrice: price,
      lastNotifiedAt: now,
    });

    const arrow = alert.direction === "above" ? "↑" : "↓";
    const repeatNote = cadence === "daily" ? " (daily reminder)" : "";
    const notification: NotificationRecord = {
      id: randomUUID(),
      userId: alert.userId,
      type: "price_alert",
      title: `Price Alert — ${alert.ticker} ${arrow} ${alert.threshold}${repeatNote}`,
      body: `${alert.name} (${alert.ticker}) is now ${price.toFixed(2)}, crossing ${alert.direction} your ${alert.threshold} target.`,
      read: false,
      createdAt: now,
    };
    await saveNotification(notification);

    // Best-effort email (no-op if EMAIL_WEBHOOK_URL unset)
    const user = await getUserById(alert.userId);
    if (user?.email) {
      void sendEmail(user.email, notification.title, notification.body);
    }
    fired += 1;
  }
  return fired;
}

/** Check all active alerts for one user on demand (called from the API). */
export async function checkAlertsForUser(userId: string): Promise<number> {
  const alerts = await getActivePriceAlertsForUser(userId);
  return evaluateAlerts(alerts);
}

/** Check every active alert (called from the interval job on persistent hosts). */
export async function checkAllActiveAlerts(): Promise<number> {
  const alerts = await getActivePriceAlerts();
  return evaluateAlerts(alerts);
}
