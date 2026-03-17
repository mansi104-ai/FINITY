import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import type { Request, Response } from "express";
import { db } from "../store/db";
import { runPythonAgents } from "../utils/pythonBridge";
import type { QueryRecord } from "../models/Query.model";
import type { AgentReport } from "../models/Report.model";

const querySchema = z.object({
  query: z.string().min(4),
  ticker: z.string().min(1).max(5).optional(),
  version: z.number().int().min(1).max(4).default(4)
});

function inferTicker(rawQuery: string): string {
  const match = rawQuery.toUpperCase().match(/\b[A-Z]{1,5}\b/);
  return match?.[0] ?? "AAPL";
}

export async function runQueryController(req: Request, res: Response) {
  if (!req.authUser) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = querySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query payload", details: parsed.error.flatten() });
  }

  const user = db.users.get(req.authUser.id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const now = new Date().toISOString();
  const ticker = parsed.data.ticker?.toUpperCase() ?? inferTicker(parsed.data.query);

  const queryRecord: QueryRecord = {
    id: uuidv4(),
    userId: user.id,
    rawQuery: parsed.data.query,
    ticker,
    version: parsed.data.version,
    status: "running",
    riskProfile: user.riskProfile,
    budget: user.budget,
    createdAt: now,
    updatedAt: now
  };

  db.queries.set(queryRecord.id, queryRecord);

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
      userId: user.id,
      query: queryRecord.rawQuery,
      ticker: queryRecord.ticker,
      version: queryRecord.version,
      sentiment: pythonResult.sentiment,
      prediction: pythonResult.prediction,
      risk: pythonResult.risk,
      recommendation: pythonResult.recommendation,
      agentLogs: pythonResult.agentLogs,
      createdAt: new Date().toISOString()
    };

    db.reports.set(report.id, report);
    db.queries.set(queryRecord.id, {
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
    db.queries.set(queryRecord.id, {
      ...queryRecord,
      status: "failed",
      updatedAt: new Date().toISOString()
    });

    const message = error instanceof Error ? error.message : "Python service failed";
    return res.status(502).json({ error: message });
  }
}
