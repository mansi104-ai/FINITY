import type { AgentReport, QueryResponse } from "../types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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
