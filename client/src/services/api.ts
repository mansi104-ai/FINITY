import type { AgentReport, AnalystRecommendation, CandlesResponse, EarningsEvent, IpoEvent, MarketHistory, MarketSnapshot, NewsResponse, QueryResponse, ResearchResponse, RiskProfile, StockQuote, StocksResponse } from "../types";

// Prefer same-origin requests so deployed clients can use a rewrite/proxy and avoid
// browser-side CORS/network failures. Keep the explicit backend URL as a fallback.
const DEFAULT_API_BASE_URL = process.env.NODE_ENV === "production"
  ? "https://server-gray-iota.vercel.app"
  : "http://localhost:4000";

const DIRECT_API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_BASE_URL)
  .trim()
  .replace(/\/$/, "");

const REPORTS_CACHE_KEY = "findec-reports-cache";
const ACCESS_TOKEN_KEY = "findec-access-token";
const SESSION_USER_KEY = "findec-session-user";
const AUTH_CHANGED_EVENT = "findec-auth-changed";

type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    budget: number;
    riskProfile: RiskProfile;
  };
};

function getAccessToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

function setAccessToken(token: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

function clearAccessToken(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
}

function dispatchAuthChanged(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

function saveSessionUser(user: AuthResponse["user"]): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
  dispatchAuthChanged();
}

function clearSessionUser(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(SESSION_USER_KEY);
  dispatchAuthChanged();
}

async function unauthenticatedRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);

  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  const candidates = typeof window === "undefined"
    ? Array.from(new Set([DIRECT_API_BASE_URL].filter(Boolean)))
    : [""];
  let lastError: Error | null = null;

  for (const baseUrl of candidates) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers,
        cache: "no-store",
        credentials: "include"
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof data?.error === "string" ? data.error : "Request failed";
        lastError = new Error(message);
        continue;
      }

      return data as T;
    } catch (error) {
      lastError =
        error instanceof Error
          ? error
          : new Error("Unable to reach the server right now. Please try again in a moment.");
    }
  }

  if (lastError?.message === "Failed to fetch") {
    throw new Error("Unable to reach the analysis server right now. Please try again in a moment.");
  }

  throw lastError ?? new Error("Request failed");
}

async function loginDemoUser(email: string, password: string, totp?: string): Promise<AuthResponse> {
  return unauthenticatedRequest<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password, ...(totp ? { totp } : {}) })
  });
}

async function registerDemoUser(email: string, password: string): Promise<AuthResponse> {
  return unauthenticatedRequest<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

async function refreshSession(): Promise<string | null> {
  try {
    const response = await unauthenticatedRequest<AuthResponse>("/api/auth/refresh", {
      method: "POST"
    });
    setAccessToken(response.accessToken);
    saveSessionUser(response.user);
    return response.accessToken;
  } catch {
    clearAccessToken();
    clearSessionUser();
    return null;
  }
}

let sessionBootstrapPromise: Promise<string | null> | null = null;

async function ensureSession(): Promise<string | null> {
  const existingToken = getAccessToken();
  if (existingToken) {
    return existingToken;
  }

  if (!sessionBootstrapPromise) {
    sessionBootstrapPromise = (async () => {
      const refreshedToken = await refreshSession();
      if (refreshedToken) {
        return refreshedToken;
      }
      return null;
    })().finally(() => {
      sessionBootstrapPromise = null;
    });
  }

  return sessionBootstrapPromise;
}

function requiresAuth(path: string): boolean {
  return path.startsWith("/api/query") || path.startsWith("/api/reports") ||
    path.startsWith("/api/profile") || path.startsWith("/api/watchlist") ||
    path.startsWith("/api/notifications") || path.startsWith("/api/alerts") ||
    path.startsWith("/api/insights/portfolio") || path.startsWith("/api/paper") ||
    path.startsWith("/api/ledger") ||
    path.startsWith("/api/auth/2fa") || path.startsWith("/api/auth/logout");
}

function getCachedReport(reportId: string): AgentReport | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const cache = window.localStorage.getItem(REPORTS_CACHE_KEY);
    if (!cache) {
      return null;
    }

    const reports = JSON.parse(cache) as Record<string, AgentReport>;
    return reports[reportId] ?? null;
  } catch {
    return null;
  }
}

function cacheReport(report: AgentReport): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const cache = window.localStorage.getItem(REPORTS_CACHE_KEY);
    const reports = cache ? (JSON.parse(cache) as Record<string, AgentReport>) : {};
    reports[report.id] = report;
    window.localStorage.setItem(REPORTS_CACHE_KEY, JSON.stringify(reports));
  } catch {
    // Silently ignore cache errors
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (requiresAuth(path)) {
    await ensureSession();
  }

  const makeAttempt = async (): Promise<T> => {
    const headers = new Headers(init.headers);
    const accessToken = getAccessToken();

    if (!headers.has("Content-Type") && init.body) {
      headers.set("Content-Type", "application/json");
    }
    if (accessToken && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }

    return unauthenticatedRequest<T>(path, {
      ...init,
      headers
    });
  };

  try {
    return await makeAttempt();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    if (requiresAuth(path) && /unauthorized|invalid token|missing refresh token|session/i.test(message)) {
      clearAccessToken();
      clearSessionUser();
      const refreshed = await ensureSession();
      if (refreshed) {
        return makeAttempt();
      }
    }
    throw error;
  }
}

export function sendQuery(payload: {
  query: string;
  ticker?: string;
  budget?: number;
  riskProfile?: "low" | "medium" | "high";
  version: number;
}): Promise<QueryResponse> {
  return request<QueryResponse>("/api/query", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getReport(reportId: string): Promise<{ report: AgentReport }> {
  try {
    const response = await request<{ report: AgentReport }>(`/api/reports/${reportId}`);
    // Cache successful responses
    if (response.report) {
      cacheReport(response.report);
    }
    return response;
  } catch (error) {
    // Fall back to cached report if server request fails
    const cached = getCachedReport(reportId);
    if (cached) {
      return { report: cached };
    }
    throw error;
  }
}

export function getReports(): Promise<{ reports: AgentReport[] }> {
  return request<{ reports: AgentReport[] }>("/api/reports");
}

export function getMarketSnapshot(): Promise<MarketSnapshot> {
  return request<MarketSnapshot>(`/api/market/snapshot${ccSuffix()}`);
}

export function getMarketHistory(ticker: string): Promise<MarketHistory> {
  return request<MarketHistory>(`/api/market/history/${encodeURIComponent(ticker)}`);
}

// ─── Region / geolocation override (v1.9, #4) ──────────────────────────────
const COUNTRY_KEY = "findec-country";

export function getSelectedCountry(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(COUNTRY_KEY);
}

export function setSelectedCountry(cc: string | null): void {
  if (typeof window === "undefined") return;
  if (cc) window.localStorage.setItem(COUNTRY_KEY, cc);
  else window.localStorage.removeItem(COUNTRY_KEY);
}

function ccSuffix(extra = false): string {
  const cc = getSelectedCountry();
  if (!cc) return "";
  return `${extra ? "&" : "?"}cc=${encodeURIComponent(cc)}`;
}

export function getCandles(ticker: string, range = "6mo"): Promise<CandlesResponse> {
  return request<CandlesResponse>(`/api/market/candles/${encodeURIComponent(ticker)}?range=${encodeURIComponent(range)}`);
}

export function getStocks(): Promise<StocksResponse> {
  return request<StocksResponse>(`/api/market/stocks${ccSuffix()}`);
}

export function getResearch(): Promise<ResearchResponse> {
  return request<ResearchResponse>(`/api/market/research${ccSuffix()}`);
}

export function getStockDetail(ticker: string): Promise<StockQuote> {
  return request<StockQuote>(`/api/market/stock/${encodeURIComponent(ticker)}`);
}

export function getNews(ticker?: string, category?: string): Promise<NewsResponse> {
  const params = new URLSearchParams();
  if (ticker) params.set("ticker", ticker);
  if (category) params.set("category", category);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return request<NewsResponse>(`/api/market/news${qs}`);
}

export function getEarnings(): Promise<{ upcoming: EarningsEvent[]; recent: EarningsEvent[] }> {
  return request<{ upcoming: EarningsEvent[]; recent: EarningsEvent[] }>("/api/market/earnings");
}

export function getIpoCalendar(): Promise<{ ipos: IpoEvent[] }> {
  return request<{ ipos: IpoEvent[] }>("/api/market/ipo");
}

export function getAnalystRecommendations(ticker: string): Promise<{ recommendations: AnalystRecommendation[] }> {
  return request<{ recommendations: AnalystRecommendation[] }>(`/api/market/recommendations/${encodeURIComponent(ticker)}`);
}

export interface StockSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

export function searchStocks(q: string): Promise<{ results: StockSearchResult[] }> {
  return request<{ results: StockSearchResult[] }>(`/api/market/search?q=${encodeURIComponent(q)}`);
}

// ─── Auth UX helpers ──────────────────────────────────────────────────────────

export async function loginUser(email: string, password: string, totp?: string): Promise<AuthResponse> {
  const response = await loginDemoUser(email, password, totp);
  setAccessToken(response.accessToken);
  saveSessionUser(response.user);
  return response;
}

// ─── 2FA (TOTP) API ─────────────────────────────────────────────────────────

export function get2faStatus(): Promise<{ enabled: boolean }> {
  return request<{ enabled: boolean }>("/api/auth/2fa/status");
}

export function enroll2fa(): Promise<{ secret: string; otpauthUri: string }> {
  return request<{ secret: string; otpauthUri: string }>("/api/auth/2fa/enroll", { method: "POST" });
}

export function activate2fa(token: string): Promise<{ enabled: boolean }> {
  return request<{ enabled: boolean }>("/api/auth/2fa/activate", { method: "POST", body: JSON.stringify({ token }) });
}

export function disable2fa(token: string): Promise<{ enabled: boolean }> {
  return request<{ enabled: boolean }>("/api/auth/2fa/disable", { method: "POST", body: JSON.stringify({ token }) });
}

export async function registerUser(email: string, password: string): Promise<AuthResponse> {
  const response = await registerDemoUser(email, password);
  setAccessToken(response.accessToken);
  saveSessionUser(response.user);
  return response;
}

export async function logoutUser(): Promise<void> {
  try { await request("/api/auth/logout", { method: "POST" }); } catch { /* ignore */ }
  clearAccessToken();
  clearSessionUser();
}

export function getSessionUser(): AuthResponse["user"] | null {
  if (typeof window === "undefined") return null;
  try {
    const s = window.localStorage.getItem(SESSION_USER_KEY);
    return s ? (JSON.parse(s) as AuthResponse["user"]) : null;
  } catch { return null; }
}

export function hasSignedInUser(): boolean {
  return getSessionUser() !== null;
}

export function subscribeToAuthChanges(callback: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handler = () => callback();
  window.addEventListener(AUTH_CHANGED_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(AUTH_CHANGED_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

// ─── Watchlist API ────────────────────────────────────────────────────────────

export interface WatchlistItemApi {
  ticker: string;
  name: string;
  addedAt: string;
  buyPrice?: number;
}

export function getWatchlist(): Promise<{ items: WatchlistItemApi[] }> {
  return request<{ items: WatchlistItemApi[] }>("/api/watchlist");
}

export function addToWatchlist(ticker: string, name: string, buyPrice?: number): Promise<{ item: WatchlistItemApi }> {
  return request<{ item: WatchlistItemApi }>("/api/watchlist", {
    method: "POST",
    body: JSON.stringify({ ticker, name, ...(buyPrice != null ? { buyPrice } : {}) })
  });
}

export function removeFromWatchlist(ticker: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/watchlist/${encodeURIComponent(ticker)}`, { method: "DELETE" });
}

export function updateWatchlistBuyPrice(ticker: string, buyPrice: number | null): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/watchlist/${encodeURIComponent(ticker)}`, {
    method: "PATCH",
    body: JSON.stringify({ buyPrice })
  });
}

// ─── Ledger API (v1.4) ──────────────────────────────────────────────────────

export interface LedgerEntry {
  id: string;
  type: "income" | "expense";
  category: string;
  amount: number;
  note?: string;
  date: string;
  createdAt: string;
}

export interface LedgerSummary { income: number; expense: number; net: number; count: number; }

export function getLedger(): Promise<{ entries: LedgerEntry[]; summary: LedgerSummary }> {
  return request<{ entries: LedgerEntry[]; summary: LedgerSummary }>("/api/ledger");
}

export function addLedgerEntry(input: { type: "income" | "expense"; category: string; amount: number; note?: string; date?: string }): Promise<{ entry: LedgerEntry }> {
  return request<{ entry: LedgerEntry }>("/api/ledger", { method: "POST", body: JSON.stringify(input) });
}

export function deleteLedgerEntry(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/ledger/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ─── Sharing + Paper Trading API (v0.8) ────────────────────────────────────────

export function shareReport(reportId: string): Promise<{ slug: string }> {
  return request<{ slug: string }>(`/api/reports/${encodeURIComponent(reportId)}/share`, { method: "POST" });
}

export function getPublicReport(slug: string): Promise<{ report: AgentReport }> {
  return unauthenticatedRequest<{ report: AgentReport }>(`/api/public/report/${encodeURIComponent(slug)}`);
}

export interface PaperPositionView {
  ticker: string;
  name: string;
  shares: number;
  avgCost: number;
  price: number;
  marketValue: number;
  pnl: number;
  pnlPercent: number;
}

export interface PaperTradeView {
  id: string;
  ticker: string;
  side: "buy" | "sell";
  shares: number;
  price: number;
  at: string;
}

export interface PaperAccount {
  cash: number;
  startingCash: number;
  positionsValue: number;
  equity: number;
  totalReturnPercent: number;
  positions: PaperPositionView[];
  trades: PaperTradeView[];
}

export function getPaperAccount(): Promise<PaperAccount> {
  return request<PaperAccount>("/api/paper");
}

export function tradePaper(ticker: string, side: "buy" | "sell", shares: number, name?: string): Promise<PaperAccount> {
  return request<PaperAccount>("/api/paper/trade", {
    method: "POST",
    body: JSON.stringify({ ticker, side, shares, ...(name ? { name } : {}) })
  });
}

export function resetPaper(): Promise<PaperAccount> {
  return request<PaperAccount>("/api/paper/reset", { method: "POST" });
}

// ─── AI Insights API (v0.7) ───────────────────────────────────────────────────

export interface PortfolioHolding {
  ticker: string;
  name: string;
  buyPrice: number;
  price: number;
  changePercent: number;
  pnl: number;
  pnlPercent: number;
  sector: string;
}

export interface PortfolioInsights {
  hasPositions: boolean;
  message?: string;
  error?: string;
  totals?: {
    positions: number;
    totalCost: number;
    totalValue: number;
    totalPnl: number;
    totalPnlPercent: number;
    winners: number;
  };
  holdings?: PortfolioHolding[];
  allocation?: Array<{ sector: string; weightPercent: number }>;
  concentration?: "low" | "moderate" | "high";
  narrative?: string[];
}

export interface MarketRegime {
  regime: "risk-on" | "risk-off" | "neutral";
  label: string;
  breadthPercent: number;
  advancing: number;
  total: number;
  avgMovePercent: number;
  score: number;
  leaders: Array<{ symbol: string; changePercent: number }>;
  laggards: Array<{ symbol: string; changePercent: number }>;
  asOf: string;
}

export function getPortfolioInsights(): Promise<PortfolioInsights> {
  return request<PortfolioInsights>("/api/insights/portfolio");
}

export function getMarketRegime(): Promise<MarketRegime> {
  return request<MarketRegime>("/api/insights/regime");
}

// ─── Price Alerts API ─────────────────────────────────────────────────────────

export type AlertCadence = "once" | "daily";

export interface PriceAlert {
  id: string;
  userId: string;
  ticker: string;
  name: string;
  direction: "above" | "below";
  threshold: number;
  active: boolean;
  cadence?: AlertCadence;
  createdAt: string;
  triggeredAt?: string;
  triggeredPrice?: number;
  lastNotifiedAt?: string;
}

export function getAlerts(): Promise<{ alerts: PriceAlert[] }> {
  return request<{ alerts: PriceAlert[] }>("/api/alerts");
}

export function createAlert(ticker: string, name: string, direction: "above" | "below", threshold: number, cadence: AlertCadence = "once"): Promise<{ alert: PriceAlert }> {
  return request<{ alert: PriceAlert }>("/api/alerts", {
    method: "POST",
    body: JSON.stringify({ ticker, name, direction, threshold, cadence })
  });
}

export function deleteAlert(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/alerts/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function checkAlerts(): Promise<{ fired: number; alerts: PriceAlert[] }> {
  return request<{ fired: number; alerts: PriceAlert[] }>("/api/alerts/check", { method: "POST" });
}

// ─── Notifications API ────────────────────────────────────────────────────────

export interface AppNotification {
  id: string;
  userId: string;
  type: "morning_digest" | "price_alert" | "system";
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export function getNotifications(): Promise<{ notifications: AppNotification[]; unreadCount: number }> {
  return request<{ notifications: AppNotification[]; unreadCount: number }>("/api/notifications");
}

export function markNotificationRead(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/notifications/${id}/read`, { method: "PATCH" });
}

export function markAllNotificationsRead(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/api/notifications/read-all", { method: "PATCH" });
}
