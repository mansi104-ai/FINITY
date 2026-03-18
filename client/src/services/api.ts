import type { AgentReport, AuthSessionResponse, AuthUser, QueryResponse, RiskProfile } from "../types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const ACCESS_TOKEN_KEY = "accessToken";
const REFRESH_TOKEN_KEY = "refreshToken";
const LEGACY_TOKEN_KEY = "token";

let refreshInFlight: Promise<string | null> | null = null;

function readStoredToken(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(key);
}

function removeStoredToken(key: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(key);
}

function writeStoredToken(key: string, value: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(key, value);
}

export function getAccessToken(): string | null {
  return readStoredToken(ACCESS_TOKEN_KEY) ?? readStoredToken(LEGACY_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return readStoredToken(REFRESH_TOKEN_KEY);
}

export function persistSessionTokens(tokens: { accessToken: string; refreshToken: string } | null): void {
  if (!tokens) {
    removeStoredToken(ACCESS_TOKEN_KEY);
    removeStoredToken(REFRESH_TOKEN_KEY);
    removeStoredToken(LEGACY_TOKEN_KEY);
    return;
  }

  writeStoredToken(ACCESS_TOKEN_KEY, tokens.accessToken);
  writeStoredToken(REFRESH_TOKEN_KEY, tokens.refreshToken);
  removeStoredToken(LEGACY_TOKEN_KEY);
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return null;
  }

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
          cache: "no-store"
        });

        if (!response.ok) {
          persistSessionTokens(null);
          return null;
        }

        const data = (await response.json()) as AuthSessionResponse;
        persistSessionTokens({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken
        });
        return data.accessToken;
      } catch {
        persistSessionTokens(null);
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }

  return refreshInFlight;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  options: { attemptRefresh?: boolean; skipAuth?: boolean } = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  const { attemptRefresh = true, skipAuth = false } = options;

  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  if (!skipAuth) {
    const token = getAccessToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store"
  });

  if (response.status === 401 && attemptRefresh && !path.startsWith("/api/auth/")) {
    const refreshedAccessToken = await refreshAccessToken();
    if (refreshedAccessToken) {
      return request<T>(path, init, { attemptRefresh: false, skipAuth });
    }
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.error === "string" ? data.error : "Request failed";
    throw new Error(message);
  }

  return data as T;
}

export function register(email: string, password: string): Promise<AuthSessionResponse> {
  return request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export function login(email: string, password: string): Promise<AuthSessionResponse> {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export function logout(): Promise<{ ok: true }> {
  return request("/api/auth/logout", { method: "POST" }, { attemptRefresh: false });
}

export function logoutAll(): Promise<{ ok: true }> {
  return request("/api/auth/logout-all", { method: "POST" }, { attemptRefresh: false });
}

export function getProfile(): Promise<{ user: AuthUser }> {
  return request("/api/profile");
}

export function updateProfile(payload: { budget: number; riskProfile: RiskProfile }): Promise<{ user: AuthUser }> {
  return request("/api/profile", {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function sendQuery(payload: {
  query: string;
  ticker?: string;
  budget?: number;
  version: number;
}): Promise<QueryResponse> {
  return request("/api/query", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getReport(reportId: string): Promise<{ report: AgentReport }> {
  return request(`/api/reports/${reportId}`);
}

export function getReports(): Promise<{ reports: AgentReport[] }> {
  return request("/api/reports");
}
