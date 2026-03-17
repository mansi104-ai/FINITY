import type { Request, Response } from "express";
import { db, listReportsByUser } from "../store/db";

export function listReportsController(req: Request, res: Response) {
  if (!req.authUser) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const reports = listReportsByUser(req.authUser.id);
  return res.status(200).json({ reports });
}

export function getReportController(req: Request, res: Response) {
  if (!req.authUser) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const report = db.reports.get(req.params.id);

  if (!report || report.userId !== req.authUser.id) {
    return res.status(404).json({ error: "Report not found" });
  }

  return res.status(200).json({ report });
}
