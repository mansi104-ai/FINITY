import type { AgentReport, AuthUser, QueryResponse, RiskProfile } from "../types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = typeof window === "undefined" ? null : window.localStorage.getItem("token");
  const headers = new Headers(init.headers);

  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store"
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = typeof data?.error === "string" ? data.error : "Request failed";
    throw new Error(message);
  }

  return data as T;
}

export function register(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
  return request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export function login(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
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
