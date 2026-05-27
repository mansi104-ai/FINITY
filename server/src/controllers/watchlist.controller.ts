import type { Request, Response } from "express";
import { getWatchlist, saveWatchlist } from "../store/db";
import type { WatchlistItem } from "../models/Watchlist.model";

export async function getWatchlistController(req: Request, res: Response) {
  const userId = req.authUser!.id;
  const record = await getWatchlist(userId);
  return res.status(200).json({ items: record?.items ?? [] });
}

export async function addWatchlistItemController(req: Request, res: Response) {
  const userId = req.authUser!.id;
  const { ticker, name, buyPrice } = req.body as { ticker?: string; name?: string; buyPrice?: number };
  if (!ticker || typeof ticker !== "string") return res.status(400).json({ error: "ticker required" });

  const record = await getWatchlist(userId);
  const items = record?.items ?? [];
  if (items.find((i) => i.ticker.toUpperCase() === ticker.toUpperCase())) {
    return res.status(409).json({ error: "Already in watchlist" });
  }

  const item: WatchlistItem = {
    ticker: ticker.toUpperCase(),
    name: name ?? ticker.toUpperCase(),
    addedAt: new Date().toISOString(),
    ...(buyPrice != null && typeof buyPrice === "number" ? { buyPrice } : {})
  };

  await saveWatchlist({ userId, items: [...items, item], updatedAt: new Date().toISOString() });
  return res.status(201).json({ item });
}

export async function removeWatchlistItemController(req: Request, res: Response) {
  const userId = req.authUser!.id;
  const ticker = String(req.params.ticker ?? "").toUpperCase();
  const record = await getWatchlist(userId);
  const items = (record?.items ?? []).filter((i) => i.ticker.toUpperCase() !== ticker);
  await saveWatchlist({ userId, items, updatedAt: new Date().toISOString() });
  return res.status(200).json({ ok: true });
}

export async function updateWatchlistItemController(req: Request, res: Response) {
  const userId = req.authUser!.id;
  const ticker = String(req.params.ticker ?? "").toUpperCase();
  const { buyPrice } = req.body as { buyPrice?: number | null };

  const record = await getWatchlist(userId);
  const items = (record?.items ?? []).map((i) => {
    if (i.ticker.toUpperCase() !== ticker) return i;
    const updated = { ...i };
    if (buyPrice == null) {
      delete updated.buyPrice;
    } else {
      updated.buyPrice = buyPrice;
    }
    return updated;
  });

  await saveWatchlist({ userId, items, updatedAt: new Date().toISOString() });
  return res.status(200).json({ ok: true });
}
