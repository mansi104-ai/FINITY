import type { Request, Response } from "express";
import { randomUUID } from "crypto";
import { getReportById, listReportsByUser, saveReport, getReportByPublicSlug } from "../store/db";

export async function listReportsController(req: Request, res: Response) {
  const reports = await listReportsByUser(req.authUser?.id ?? "public");
  return res.status(200).json({ reports });
}

export async function getReportController(req: Request, res: Response) {
  const report = await getReportById(req.params.id);

  if (!report || report.userId !== (req.authUser?.id ?? "public")) {
    return res.status(404).json({ error: "Report not found" });
  }

  return res.status(200).json({ report });
}

// Publish (or return existing) a public, read-only share slug for a report.
export async function shareReportController(req: Request, res: Response) {
  const userId = req.authUser?.id ?? "public";
  const report = await getReportById(req.params.id);
  if (!report || report.userId !== userId) {
    return res.status(404).json({ error: "Report not found" });
  }
  if (!report.publicSlug) {
    report.publicSlug = randomUUID().replace(/-/g, "").slice(0, 12);
    await saveReport(report);
  }
  return res.status(200).json({ slug: report.publicSlug });
}

// Public, unauthenticated read by share slug.
export async function getPublicReportController(req: Request, res: Response) {
  const slug = String(req.params.slug ?? "").trim();
  if (!slug) return res.status(400).json({ error: "slug required" });
  const report = await getReportByPublicSlug(slug);
  if (!report) return res.status(404).json({ error: "Shared report not found" });
  return res.status(200).json({ report });
}
