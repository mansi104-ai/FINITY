import axios from "axios";

/**
 * Yahoo Finance fundamentals via the cookie + crumb flow (v1.25.0).
 *
 * Yahoo's `v7/quote` (fundamentals) is IP-blocked on Vercel, and its
 * `v10/quoteSummary` needs a crumb. But the crumb flow is auth, not an IP block —
 * and it returns FULL fundamentals for EVERY market for free, including India/NSE
 * (P/E, market cap, EPS, dividend, beta, P/B, 52w, MA50/200, volume). This is the
 * free replacement for the paid FMP tier for India/global fundamentals.
 *
 * The cookie+crumb are cached process-wide (~50 min) so we authenticate once.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type Session = { cookie: string; crumb: string; ts: number };
let session: Session | null = null;
const SESSION_TTL_MS = 50 * 60 * 1000;

async function getSession(force = false): Promise<Session | null> {
  if (!force && session && Date.now() - session.ts < SESSION_TTL_MS) return session;
  try {
    // 1. Obtain a cookie.
    const cookieRes = await axios.get("https://fc.yahoo.com/", {
      headers: { "User-Agent": UA, Accept: "text/html" },
      timeout: 7000,
      validateStatus: () => true,
      maxRedirects: 0,
    });
    const setCookie = cookieRes.headers["set-cookie"];
    const cookie = Array.isArray(setCookie)
      ? setCookie.map((c) => c.split(";")[0]).join("; ")
      : "";
    if (!cookie) return null;
    // 2. Get a crumb scoped to that cookie.
    const crumbRes = await axios.get("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, Cookie: cookie, Accept: "text/plain" },
      timeout: 7000,
    });
    const crumb = String(crumbRes.data ?? "").trim();
    if (!crumb || crumb.length > 32) return null; // a valid crumb is short
    session = { cookie, crumb, ts: Date.now() };
    return session;
  } catch {
    return null;
  }
}

export interface YahooFundamentals {
  marketCap?: number;
  peRatio?: number;
  forwardPE?: number;
  eps?: number;
  dividendYield?: number; // percent
  beta?: number;
  priceToBook?: number;
  high52w?: number;
  low52w?: number;
  ma50?: number;
  ma200?: number;
  volume?: number;
  avgVolume?: number;
}

const raw = (o: unknown): number | undefined => {
  if (o == null) return undefined;
  if (typeof o === "number") return Number.isFinite(o) ? o : undefined;
  if (typeof o === "object" && "raw" in (o as Record<string, unknown>)) {
    const v = (o as { raw?: unknown }).raw;
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  }
  return undefined;
};

const MODULES = "summaryDetail,defaultKeyStatistics,price";

/** Fetch fundamentals for one Yahoo-style symbol (RELIANCE.NS, AAPL, SHEL.L…). */
export async function getYahooFundamentals(symbol: string): Promise<YahooFundamentals | null> {
  let s = await getSession();
  if (!s) return null;

  const fetchOnce = async (sess: Session) => {
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`;
    return axios.get(url, {
      params: { modules: MODULES, crumb: sess.crumb },
      headers: { "User-Agent": UA, Cookie: sess.cookie, Accept: "application/json" },
      timeout: 8000,
      validateStatus: () => true,
    });
  };

  let res = await fetchOnce(s);
  // A 401/Invalid Crumb means the session went stale — refresh once and retry.
  if (res.status === 401 || (res.data?.quoteSummary?.error)) {
    s = await getSession(true);
    if (!s) return null;
    res = await fetchOnce(s);
  }

  const result = res.data?.quoteSummary?.result?.[0];
  if (!result) return null;
  const sd = result.summaryDetail ?? {};
  const ks = result.defaultKeyStatistics ?? {};
  const pr = result.price ?? {};

  const dy = raw(sd.dividendYield);
  const out: YahooFundamentals = {
    marketCap: raw(pr.marketCap) ?? raw(sd.marketCap),
    peRatio: raw(sd.trailingPE),
    forwardPE: raw(sd.forwardPE),
    eps: raw(ks.trailingEps),
    dividendYield: dy != null ? +(dy * 100).toFixed(2) : undefined,
    beta: raw(sd.beta) ?? raw(ks.beta),
    priceToBook: raw(ks.priceToBook),
    high52w: raw(sd.fiftyTwoWeekHigh),
    low52w: raw(sd.fiftyTwoWeekLow),
    ma50: raw(sd.fiftyDayAverage),
    ma200: raw(sd.twoHundredDayAverage),
    volume: raw(sd.volume) ?? raw(sd.regularMarketVolume),
    avgVolume: raw(sd.averageVolume),
  };
  // Only return if we actually got something useful.
  if (out.marketCap == null && out.peRatio == null && out.eps == null && out.beta == null) return null;
  return out;
}

// ─── Earnings (calendar) ──────────────────────────────────────────────────────
export interface YahooEarnings {
  symbol: string;
  name?: string;
  nextDate?: string;        // upcoming earnings date (ISO)
  epsEstimate?: number;     // consensus EPS for the upcoming quarter
  lastDate?: string;        // most recent reported quarter date
  lastEpsActual?: number;
  lastEpsEstimate?: number;
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Next + most-recent earnings for one symbol (calendarEvents + earningsHistory). */
export async function getYahooEarnings(symbol: string): Promise<YahooEarnings | null> {
  let s = await getSession();
  if (!s) return null;
  const run = async (sess: Session) => axios.get(
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`,
    {
      params: { modules: "calendarEvents,earningsHistory,price", crumb: sess.crumb },
      headers: { "User-Agent": UA, Cookie: sess.cookie, Accept: "application/json" },
      timeout: 8000, validateStatus: () => true,
    }
  );
  let res = await run(s);
  if (res.status === 401 || res.data?.quoteSummary?.error) {
    s = await getSession(true);
    if (!s) return null;
    res = await run(s);
  }
  const r = res.data?.quoteSummary?.result?.[0];
  if (!r) return null;

  const earn = r.calendarEvents?.earnings ?? {};
  const dates: number[] = (earn.earningsDate ?? []).map((d: { raw?: number }) => d?.raw).filter((n: unknown): n is number => typeof n === "number");
  const nextRaw = dates.length ? Math.min(...dates) * 1000 : undefined;
  const hist = r.earningsHistory?.history ?? [];
  const last = hist.length ? hist[hist.length - 1] : undefined;
  const lastRaw = raw(last?.quarter);

  const out: YahooEarnings = {
    symbol,
    name: r.price?.shortName ?? r.price?.longName ?? undefined,
    nextDate: nextRaw ? isoDay(nextRaw) : undefined,
    epsEstimate: raw(earn.earningsAverage),
    lastDate: lastRaw ? isoDay(lastRaw * 1000) : undefined,
    lastEpsActual: raw(last?.epsActual),
    lastEpsEstimate: raw(last?.epsEstimate),
  };
  if (!out.nextDate && !out.lastDate) return null;
  return out;
}
