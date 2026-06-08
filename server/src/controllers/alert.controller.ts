import type { Request, Response } from "express";
import { randomUUID } from "crypto";
import { getPriceAlertsForUser, savePriceAlert, deletePriceAlert } from "../store/db";
import type { AlertDirection, PriceAlertRecord } from "../models/PriceAlert.model";
import { checkAlertsForUser } from "../services/priceAlerts";

export async function listAlertsController(req: Request, res: Response) {
  const userId = req.authUser!.id;
  const alerts = await getPriceAlertsForUser(userId);
  return res.status(200).json({ alerts });
}

export async function createAlertController(req: Request, res: Response) {
  const userId = req.authUser!.id;
  const { ticker, name, direction, threshold } = req.body as {
    ticker?: string; name?: string; direction?: string; threshold?: number;
  };

  if (!ticker || typeof ticker !== "string") return res.status(400).json({ error: "ticker required" });
  if (direction !== "above" && direction !== "below") return res.status(400).json({ error: "direction must be 'above' or 'below'" });
  if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold <= 0) {
    return res.status(400).json({ error: "threshold must be a positive number" });
  }

  const alert: PriceAlertRecord = {
    id: randomUUID(),
    userId,
    ticker: ticker.toUpperCase(),
    name: name?.trim() || ticker.toUpperCase(),
    direction: direction as AlertDirection,
    threshold,
    active: true,
    createdAt: new Date().toISOString(),
  };

  await savePriceAlert(alert);
  return res.status(201).json({ alert });
}

export async function deleteAlertController(req: Request, res: Response) {
  const userId = req.authUser!.id;
  const id = String(req.params.id ?? "");
  if (!id) return res.status(400).json({ error: "id required" });
  await deletePriceAlert(id, userId);
  return res.status(200).json({ ok: true });
}

/**
 * On-demand evaluation — the client can call this (e.g. alongside the
 * notification poll) so price alerts also work on serverless hosts where
 * the background interval does not run.
 */
export async function checkAlertsController(req: Request, res: Response) {
  const userId = req.authUser!.id;
  const fired = await checkAlertsForUser(userId);
  const alerts = await getPriceAlertsForUser(userId);
  return res.status(200).json({ fired, alerts });
}
