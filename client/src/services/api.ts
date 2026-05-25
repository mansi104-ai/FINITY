import type { AgentReport, MarketHistory, MarketSnapshot, NewsResponse, QueryResponse, RiskProfile, StockQuote, StocksResponse } from "../types";

// Prefer same-origin requests so deployed clients can use a rewrite/proxy and avoid
// browser-side CORS/network failures. Keep the explicit backend URL as a fallback.
const DIRECT_API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "https://server-gray-iota.vercel.app")
  .trim()
  .replace(/\/$/, "");

const REPORTS_CACHE_KEY = "findec-reports-cache";
const ACCESS_TOKEN_KEY = "findec-access-token";
const DEMO_EMAIL_KEY = "findec-demo-email";
const DEMO_PASSWORD_KEY = "findec-demo-password";
const SESSION_USER_KEY = "findec-session-user";

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

function saveSessionUser(user: AuthResponse["user"]): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
}

function buildDemoCredentials(): { email: string; password: string } {
  if (typeof window === "undefined") {
    return {
      email: "demo@findec.local",
      password: "FindecDemoPass123!"
    };
  }

  const existingEmail = window.localStorage.getItem(DEMO_EMAIL_KEY);
  const existingPassword = window.localStorage.getItem(DEMO_PASSWORD_KEY);
  if (existingEmail && existingPassword) {
    return { email: existingEmail, password: existingPassword };
  }

  const seed = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`;
  const compactSeed = seed.replace(/[^a-zA-Z0-9]/g, "");
  const email = `demo-${compactSeed.toLowerCase()}@findec.local`;
  const password = `Findec!${compactSeed.slice(0, 12)}Ab9`;
  window.localStorage.setItem(DEMO_EMAIL_KEY, email);
  window.localStorage.setItem(DEMO_PASSWORD_KEY, password);
  return { email, password };
}

async function unauthenticatedRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);

  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  const candidates = Array.from(new Set(["", DIRECT_API_BASE_URL].filter(Boolean)));
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

async function loginDemoUser(email: string, password: string): Promise<AuthResponse> {
  return unauthenticatedRequest<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
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

      const { email, password } = buildDemoCredentials();
      try {
        const response = await loginDemoUser(email, password);
        setAccessToken(response.accessToken);
        saveSessionUser(response.user);
        return response.accessToken;
      } catch {
        const response = await registerDemoUser(email, password);
        setAccessToken(response.accessToken);
        saveSessionUser(response.user);
        return response.accessToken;
      }
    })().finally(() => {
      sessionBootstrapPromise = null;
    });
  }

  return sessionBootstrapPromise;
}

function requiresAuth(path: string): boolean {
  return path.startsWith("/api/query") || path.startsWith("/api/reports") || path.startsWith("/api/profile");
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
  return request<MarketSnapshot>("/api/market/snapshot");
}

export function getMarketHistory(ticker: string): Promise<MarketHistory> {
  return request<MarketHistory>(`/api/market/history/${encodeURIComponent(ticker)}`);
}

export function getStocks(): Promise<StocksResponse> {
  return request<StocksResponse>("/api/market/stocks");
}

export function getStockDetail(ticker: string): Promise<StockQuote> {
  return request<StockQuote>(`/api/market/stock/${encodeURIComponent(ticker)}`);
}

export function getNews(ticker?: string): Promise<NewsResponse> {
  const qs = ticker ? `?ticker=${encodeURIComponent(ticker)}` : "";
  return request<NewsResponse>(`/api/market/news${qs}`);
}
