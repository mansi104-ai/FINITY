import type { Request, Response } from "express";
import { randomUUID } from "crypto";
import { getPriceAlertsForUser, savePriceAlert, deletePriceAlert } from "../store/db";
import type { AlertCadence, AlertDirection, PriceAlertRecord } from "../models/PriceAlert.model";
import { checkAlertsForUser, checkAllActiveAlerts } from "../services/priceAlerts";
import { env } from "../config";

export async function listAlertsController(req: Request, res: Response) {
  const userId = req.authUser!.id;
  const alerts = await getPriceAlertsForUser(userId);
  return res.status(200).json({ alerts });
}

export async function createAlertController(req: Request, res: Response) {
  const userId = req.authUser!.id;
  const { ticker, name, direction, threshold, cadence } = req.body as {
    ticker?: string; name?: string; direction?: string; threshold?: number; cadence?: string;
  };

  if (!ticker || typeof ticker !== "string") return res.status(400).json({ error: "ticker required" });
  if (direction !== "above" && direction !== "below") return res.status(400).json({ error: "direction must be 'above' or 'below'" });
  if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold <= 0) {
    return res.status(400).json({ error: "threshold must be a positive number" });
  }
  const alertCadence: AlertCadence = cadence === "daily" ? "daily" : "once";

  const alert: PriceAlertRecord = {
    id: randomUUID(),
    userId,
    ticker: ticker.toUpperCase(),
    name: name?.trim() || ticker.toUpperCase(),
    direction: direction as AlertDirection,
    threshold,
    active: true,
    cadence: alertCadence,
    createdAt: new Date().toISOString(),
  };

  await savePriceAlert(alert);

  // Evaluate immediately so an already-crossed alert fires right away instead of
  // waiting for the next poll (a common "nothing happened" confusion).
  let fired = 0;
  try { fired = await checkAlertsForUser(userId); } catch { /* best-effort */ }

  return res.status(201).json({ alert, fired });
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

/**
 * Cron sweep — evaluates EVERY user's active alerts. Unauthenticated (Vercel
 * Cron can't log in as a user) but gated by a secret so it can't be abused.
 * Accepts the secret via `?key=` or the `x-vercel-cron` header that Vercel
 * automatically attaches to scheduled invocations.
 */
export async function cronCheckAlertsController(req: Request, res: Response) {
  const secret = env.cronSecret;
  const provided = String(req.query.key ?? "") || (req.headers["authorization"] as string | undefined)?.replace(/^Bearer\s+/i, "");
  const isVercelCron = req.headers["x-vercel-cron"] != null;
  if (secret && provided !== secret && !isVercelCron) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const fired = await checkAllActiveAlerts();
  return res.status(200).json({ ok: true, fired });
}
