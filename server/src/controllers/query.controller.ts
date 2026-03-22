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
  version: z.number().int().min(1).max(4).default(2)
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

  const queryRecord: QueryRecord = {
    id: uuidv4(),
    userId: "public",
    rawQuery: parsed.data.query,
    ticker,
    version: parsed.data.version,
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
      version: queryRecord.version
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

    return res.status(200).json({
      ok: true,
      reportId: report.id,
      report
    });
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
