import type { AgentReport, MarketSnapshot, QueryResponse } from "../types";

// Prefer same-origin requests so deployed clients can use a rewrite/proxy and avoid
// browser-side CORS/network failures. Keep the explicit backend URL as a fallback.
const DIRECT_API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "https://server-gray-iota.vercel.app")
  .trim()
  .replace(/\/$/, "");

const REPORTS_CACHE_KEY = "findec-reports-cache";

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
  return request<QueryResponse>("/api/query", {
    method: "POST",
    body: JSON.stringify(payload)
  }).then((response) => {
    // Cache the report when it's generated
    if (response.report) {
      cacheReport(response.report);
    }
    return response;
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
