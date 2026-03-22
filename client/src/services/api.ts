import type { AgentReport, MarketSnapshot, QueryResponse } from "../types";

// Default to the live API in production-like environments, and tolerate accidental
// whitespace in hosted env vars so browser fetches don't fail on malformed URLs.
const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "https://server-gray-iota.vercel.app")
  .trim()
  .replace(/\/$/, "");

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);

  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
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

export function sendQuery(payload: {
  query: string;
  ticker?: string;
  budget?: number;
  riskProfile?: "low" | "medium" | "high";
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

export function getMarketSnapshot(): Promise<MarketSnapshot> {
  return request("/api/market/snapshot");
}
