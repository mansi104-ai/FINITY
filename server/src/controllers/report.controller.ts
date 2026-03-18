import type { Request, Response } from "express";
import { getReportById, listReportsByUser } from "../store/db";

export async function listReportsController(req: Request, res: Response) {
  const reports = await listReportsByUser("public");
  return res.status(200).json({ reports });
}

export async function getReportController(req: Request, res: Response) {
  const report = await getReportById(req.params.id);

  if (!report) {
    return res.status(404).json({ error: "Report not found" });
  }

  return res.status(200).json({ report });
}
