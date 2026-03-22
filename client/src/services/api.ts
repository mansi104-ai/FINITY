import type { AgentReport, MarketSnapshot, QueryResponse } from "../types";

// Prefer same-origin requests so deployed clients can use a rewrite/proxy and avoid
// browser-side CORS/network failures. Keep the explicit backend URL as a fallback.
const DIRECT_API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "https://server-gray-iota.vercel.app")
  .trim()
  .replace(/\/$/, "");

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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
        cache: "no-store"
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
