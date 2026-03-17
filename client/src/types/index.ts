export type RiskProfile = "low" | "medium" | "high";

export type AgentState = "queued" | "running" | "completed" | "failed";

export interface AgentStatus {
  agent: string;
  state: AgentState;
  durationMs?: number;
  message?: string;
}

export interface SentimentResult {
  label: "bullish" | "bearish" | "neutral";
  score: number;
  confidence: number;
}

export interface PredictionResult {
  ticker: string;
  currentPrice: number;
  predictedPrice: number;
  predictedReturnPct: number;
  history: number[];
  forecast: number[];
}

export interface RiskResult {
  valueAtRiskPct: number;
  level: "low" | "medium" | "high";
  recommendedPositionSizePct: number;
}

export interface FinalRecommendation {
  action: "buy" | "sell" | "hold";
  reason: string;
  suggestedAmount: number;
}

export interface AgentReport {
  id: string;
  userId: string;
  query: string;
  ticker: string;
  version: number;
  sentiment?: SentimentResult;
  prediction?: PredictionResult;
  risk?: RiskResult;
  recommendation: FinalRecommendation;
  agentLogs: AgentStatus[];
  createdAt: string;
}

export interface QueryResponse {
  ok: boolean;
  reportId: string;
  report: AgentReport;
}

export interface AuthUser {
  id: string;
  email: string;
  budget: number;
  riskProfile: RiskProfile;
}
