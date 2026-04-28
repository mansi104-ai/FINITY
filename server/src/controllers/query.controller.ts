import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import type { Request, Response } from "express";
import { saveQuery, saveReport } from "../store/db";
import { runPythonAgents, PythonServiceError } from "../utils/pythonBridge";
import type { QueryRecord } from "../models/Query.model";
import type { AgentReport } from "../models/Report.model";
import type { RiskProfile } from "../models/User.model";

const querySchema = z.object({
  query: z.string().min(4),
  ticker: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9.-]{0,14}$/, "Ticker must look like AAPL or RELIANCE.NS")
    .optional(),
  budget: z.number().min(100).max(10_000_000).optional(),
  riskProfile: z.enum(["low", "medium", "high"]).optional(),
  version: z.number().int().min(1).max(4).default(4)
});

const COMPANY_SYMBOL_MAP: Record<string, string> = {
  apple: "AAPL",
  microsoft: "MSFT",
  google: "GOOGL",
  alphabet: "GOOGL",
  amazon: "AMZN",
  tesla: "TSLA",
  nvidia: "NVDA",
  meta: "META",
  netflix: "NFLX"
};

const STOP_WORDS = new Set([
  "SHOULD",
  "BUY",
  "SELL",
  "HOLD",
  "THIS",
  "STOCK",
  "WEEK",
  "MONTH",
  "YEAR",
  "NOW",
  "FOR",
  "THE",
  "AND",
  "OR",
  "IS",
  "IT",
  "A",
  "AN",
  "OF",
  "TO"
]);

type FinityAgentResponse = {
  estimated: boolean;
  researcher: {
    sentiment: "Bullish" | "Neutral" | "Bearish";
    sentiment_confidence: number;
    bull_ratio: number;
    bear_ratio: number;
    top_signals: [string, string, string];
  };
  analyst: {
    pe_ratio: number;
    pe_context: string;
    momentum_5d: string;
    momentum_context: string;
    ai_confidence: number;
    ai_confidence_context: string;
    outlook: "Positive" | "Neutral" | "Cautious";
    outlook_timeframe: string;
  };
  risk_manager: {
    suitability: "Suited for you" | "Neutral" | "Not suited";
    risk_note: string;
    opportunity_note: string;
    action: string;
  };
};

function inferTicker(rawQuery: string): string | undefined {
  const dollarMatch = rawQuery.toUpperCase().match(/\$([A-Z][A-Z0-9.-]{0,14})\b/);
  if (dollarMatch?.[1]) {
    return dollarMatch[1];
  }

  const lower = rawQuery.toLowerCase();
  for (const [company, symbol] of Object.entries(COMPANY_SYMBOL_MAP)) {
    if (lower.includes(company)) {
      return symbol;
    }
  }

  const candidates = rawQuery.toUpperCase().match(/\b[A-Z][A-Z0-9.-]{0,14}\b/g) ?? [];
  return candidates.find((token) => !STOP_WORDS.has(token));
}

function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function capWords(text: string, maxWords: number): string {
  const words = text
    .replace(/[^a-zA-Z0-9%+\- ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words.slice(0, maxWords).join(" ");
}

function sentenceCase(text: string): string {
  if (!text) {
    return text;
  }

  return text.charAt(0).toUpperCase() + text.slice(1);
}

function buildTopSignals(report: AgentReport, estimated: boolean): [string, string, string] {
  const momentum = Number(report.prediction?.predictedReturnPct ?? 0);
  const sentimentLevel = report.sentiment?.level ?? "HOLD";
  const riskLevel = report.risk?.level ?? "medium";

  const signals = [
    momentum > 1 ? "Price trend is improving" : momentum < -1 ? "Price trend is weakening" : "Price trend is mixed",
    sentimentLevel === "BUY" || sentimentLevel === "STRONG_BUY"
      ? "News flow leans positive"
      : sentimentLevel === "SELL" || sentimentLevel === "STRONG_SELL"
        ? "News flow leans negative"
        : "News flow looks balanced",
    riskLevel === "low" ? "Risk looks manageable today" : riskLevel === "high" ? "Risk looks elevated today" : "Risk needs patience today"
  ];

  if (estimated) {
    signals[2] = "Using fallback sample data";
  }

  return signals.map((signal) => capWords(signal, 11)) as [string, string, string];
}

function mapSentiment(level?: string): "Bullish" | "Neutral" | "Bearish" {
  if (level === "BUY" || level === "STRONG_BUY") {
    return "Bullish";
  }
  if (level === "SELL" || level === "STRONG_SELL") {
    return "Bearish";
  }
  return "Neutral";
}

function buildPeContext(peRatio: number, estimated: boolean): string {
  if (estimated) {
    return "Estimated valuation using fallback market data.";
  }
  if (peRatio >= 32) {
    return "High versus many peers, growth expectations are strong.";
  }
  if (peRatio >= 22) {
    return "Above average, but still reasonable for growth.";
  }
  if (peRatio >= 14) {
    return "Near common market ranges, looks fairly priced.";
  }
  return "Low versus many peers, market expects slower growth.";
}

function buildMomentumContext(momentum5d: number, estimated: boolean): string {
  if (estimated) {
    return "Estimated from fallback price history.";
  }
  if (momentum5d >= 2) {
    return "Rising steadily over the last week.";
  }
  if (momentum5d <= -2) {
    return "Falling steadily over the last week.";
  }
  return "Mostly flat with small daily moves.";
}

function buildConfidenceContext(confidence: number, estimated: boolean): string {
  if (estimated) {
    return "Confidence is estimated from synthetic inputs.";
  }
  if (confidence >= 75) {
    return "Signals align well across news and price action.";
  }
  if (confidence >= 55) {
    return "Some signals agree, but conviction is moderate.";
  }
  return "Signals are mixed, so conviction is limited.";
}

function buildOutlook(prediction?: AgentReport["prediction"]): "Positive" | "Neutral" | "Cautious" {
  if (!prediction) {
    return "Neutral";
  }
  if (prediction.trend === "bullish" && prediction.confidence >= 0.6) {
    return "Positive";
  }
  if (prediction.trend === "bearish") {
    return "Cautious";
  }
  return "Neutral";
}

function buildTimeframe(prediction?: AgentReport["prediction"]): string {
  const label = prediction?.horizonLabel?.toLowerCase() ?? "";
  if (label.includes("today")) {
    return "Today";
  }
  if (label.includes("1-2")) {
    return "1-2 sessions";
  }
  if (label.includes("week") || label.includes("5 trading")) {
    return "1 week";
  }
  if (label.includes("month")) {
    return "2-4 weeks";
  }
  return "1-2 weeks";
}

function estimatePeRatio(report: AgentReport): number {
  const confidence = Number(report.prediction?.confidence ?? 0.55);
  const volatility = Number(report.prediction?.volatilityBandPct ?? 2.5);
  const baseline = 18 + confidence * 10 - Math.min(volatility, 8) * 0.7;
  const pe = Math.max(9, Math.min(38, baseline));
  return Number(pe.toFixed(1));
}

function calculateMomentum5d(report: AgentReport): number {
  const history = report.prediction?.history ?? [];
  if (history.length >= 6) {
    const start = history[history.length - 6];
    const end = history[history.length - 1];
    if (start > 0) {
      return Number((((end - start) / start) * 100).toFixed(1));
    }
  }

  return Number((report.prediction?.predictedReturnPct ?? 0).toFixed(1));
}

function buildSuitability(report: AgentReport, riskProfile: RiskProfile): "Suited for you" | "Neutral" | "Not suited" {
  const riskLevel = report.risk?.level ?? "medium";
  const outlook = buildOutlook(report.prediction);

  if (riskProfile === "low" && riskLevel === "high") {
    return "Not suited";
  }
  if (outlook === "Positive" && (riskLevel === "low" || riskProfile === "high")) {
    return "Suited for you";
  }
  if (outlook === "Cautious" && riskProfile !== "high") {
    return "Not suited";
  }
  return "Neutral";
}

function buildRiskNote(report: AgentReport, estimated: boolean): string {
  if (estimated) {
    return "Risk view uses fallback history, so treat carefully.";
  }
  const riskLevel = report.risk?.level ?? "medium";
  if (riskLevel === "high") {
    return "Price swings look high for a first investment.";
  }
  if (riskLevel === "low") {
    return "Recent swings look calmer than many stocks.";
  }
  return "Risk is moderate, so avoid rushing in.";
}

function buildOpportunityNote(report: AgentReport, estimated: boolean): string {
  if (estimated) {
    return "Potential upside is estimated, not live market based.";
  }
  const predictedReturn = Number(report.prediction?.predictedReturnPct ?? 0);
  if (predictedReturn >= 2) {
    return "Short-term upside looks healthy if momentum holds.";
  }
  if (predictedReturn <= -1) {
    return "Better opportunity may come after more stability.";
  }
  return "Opportunity exists, but it needs more confirmation.";
}

function buildAction(report: AgentReport, estimated: boolean): string {
  if (estimated) {
    return "Watch the stock today, but confirm with live prices before investing.";
  }
  const outlook = buildOutlook(report.prediction);
  if (outlook === "Positive") {
    return "Add this to your watchlist and check if strength holds by market close.";
  }
  if (outlook === "Cautious") {
    return "Wait today and only revisit if the price stabilizes.";
  }
  return "Watch today's trend and wait for clearer direction.";
}

function isEstimatedReport(report: AgentReport): boolean {
  const usedSyntheticResearch =
    report.sentiment?.resources?.some((resource) => resource.source.toLowerCase().includes("synthetic")) ?? false;
  const usedSyntheticPricing =
    report.prediction?.methodFactors?.some((factor) => factor.toLowerCase().includes("synthetic")) ?? false;

  return usedSyntheticResearch || usedSyntheticPricing;
}

function toFinityResponse(report: AgentReport, riskProfile: RiskProfile): FinityAgentResponse {
  const estimated = isEstimatedReport(report);
  const sentimentScore = Number(report.sentiment?.score ?? 0);
  const bullRatio = Math.round(Math.max(0, Math.min(100, ((sentimentScore + 2) / 4) * 100)));
  const bearRatio = 100 - bullRatio;
  const momentum5d = calculateMomentum5d(report);
  const aiConfidence = Math.round(Number(report.prediction?.confidence ?? 0.55) * 100);
  const peRatio = estimatePeRatio(report);

  return {
    estimated,
    researcher: {
      sentiment: mapSentiment(report.sentiment?.level),
      sentiment_confidence: Math.round(Number(report.sentiment?.confidence ?? 0.5) * 100),
      bull_ratio: bullRatio,
      bear_ratio: bearRatio,
      top_signals: buildTopSignals(report, estimated)
    },
    analyst: {
      pe_ratio: peRatio,
      pe_context: sentenceCase(buildPeContext(peRatio, estimated)),
      momentum_5d: formatPercent(momentum5d),
      momentum_context: sentenceCase(buildMomentumContext(momentum5d, estimated)),
      ai_confidence: aiConfidence,
      ai_confidence_context: sentenceCase(buildConfidenceContext(aiConfidence, estimated)),
      outlook: buildOutlook(report.prediction),
      outlook_timeframe: buildTimeframe(report.prediction)
    },
    risk_manager: {
      suitability: buildSuitability(report, riskProfile),
      risk_note: sentenceCase(buildRiskNote(report, estimated)),
      opportunity_note: sentenceCase(buildOpportunityNote(report, estimated)),
      action: sentenceCase(buildAction(report, estimated))
    }
  };
}

export async function runQueryController(req: Request, res: Response) {
  const parsed = querySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query payload", details: parsed.error.flatten() });
  }

  const now = new Date().toISOString();
  const ticker = parsed.data.ticker ?? inferTicker(parsed.data.query);
  const budget = parsed.data.budget ?? 10_000;
  const riskProfile = (parsed.data.riskProfile ?? "medium") as RiskProfile;

  if (!ticker) {
    return res.status(400).json({
      error: "Unable to infer ticker. Please provide a symbol like AAPL or TSLA."
    });
  }

  const version = 4;

  const queryRecord: QueryRecord = {
    id: uuidv4(),
    userId: "public",
    rawQuery: parsed.data.query,
    ticker,
    version,
    status: "running",
    riskProfile,
    budget,
    createdAt: now,
    updatedAt: now
  };

  await saveQuery(queryRecord);

  try {
    const pythonResult = await runPythonAgents({
      query: queryRecord.rawQuery,
      ticker: queryRecord.ticker,
      budget: queryRecord.budget,
      risk_profile: queryRecord.riskProfile,
      version
    });

    const report: AgentReport = {
      id: uuidv4(),
      userId: "public",
      query: queryRecord.rawQuery,
      ticker: queryRecord.ticker,
      version: queryRecord.version,
      budget: queryRecord.budget,
      sentiment: pythonResult.sentiment,
      prediction: pythonResult.prediction,
      risk: pythonResult.risk,
      recommendation: pythonResult.recommendation,
      agentLogs: pythonResult.agentLogs,
      createdAt: new Date().toISOString()
    };

    await saveReport(report);
    await saveQuery({
      ...queryRecord,
      status: "completed",
      updatedAt: new Date().toISOString()
    });

    return res.status(200).json(toFinityResponse(report, riskProfile));
  } catch (error) {
    await saveQuery({
      ...queryRecord,
      status: "failed",
      updatedAt: new Date().toISOString()
    });

    // Handle Python service errors with appropriate HTTP status codes
    if (error instanceof PythonServiceError) {
      const statusCode =
        error.code === "UNREACHABLE"
          ? 503 // Service Unavailable
          : error.code === "TIMEOUT"
            ? 504 // Gateway Timeout
            : 502; // Bad Gateway

      return res.status(statusCode).json({ error: error.message });
    }

    // Handle unexpected errors
    const message = error instanceof Error ? error.message : "Analysis service failed";
    console.error("Unexpected error in query controller:", error);
    return res.status(502).json({ error: message });
  }
}
