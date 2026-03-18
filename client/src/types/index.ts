export type RiskProfile = "low" | "medium" | "high";

export type SentimentLevel = "STRONG_SELL" | "SELL" | "HOLD" | "BUY" | "STRONG_BUY";

export type AgentState = "queued" | "running" | "completed" | "failed";

export interface AgentStatus {
  agent: string;
  state: AgentState;
  durationMs?: number;
  message?: string;
}

export interface ResearchResource {
  title: string;
  source: string;
  url?: string;
  publishedAt: string;
  snippet?: string;
  sentimentLevel?: SentimentLevel;
}

export interface ResearchSearchAttempt {
  query: string;
  phase: "from_scratch" | "reiteration";
  source: string;
  status: "success" | "failed" | "skipped";
  resultCount: number;
  startedAt: string;
  endedAt: string;
  note?: string;
}

export interface ResearchTimeline {
  from: string;
  to: string;
  generatedAt: string;
}

export interface ResearchStats {
  searchesFromScratch: number;
  reiterations: number;
  totalSearches: number;
  successfulSearches: number;
}

export interface SentimentResult {
  level: SentimentLevel;
  score: number;
  confidence: number;
  resources?: ResearchResource[];
  timeline?: ResearchTimeline;
  searchStats?: ResearchStats;
  searchAttempts?: ResearchSearchAttempt[];
  reasoning?: string[];
  synthesis?: {
    strong_buy: number;
    buy: number;
    hold: number;
    sell: number;
    strong_sell: number;
    total: number;
  };
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

export interface DecisionTraceEntry {
  stage: string;
  detail: string;
  outcome: string;
}

export interface FinalRecommendation {
  action: "buy" | "sell" | "hold";
  reason: string;
  suggestedAmount: number;
  buyScore?: number;
  buyThreshold?: number;
  verdict?: "buy_now" | "wait" | "avoid";
  decisionTrace?: DecisionTraceEntry[];
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
