import type { Request, Response } from "express";
import { randomUUID } from "crypto";
import { getPaperAccount, savePaperAccount } from "../store/db";
import { fetchQuoteForSymbol } from "./market.controller";
import { PAPER_STARTING_CASH, type PaperAccountRecord, type PaperPosition } from "../models/PaperAccount.model";

function newAccount(userId: string): PaperAccountRecord {
  const now = new Date().toISOString();
  return {
    userId, cash: PAPER_STARTING_CASH, startingCash: PAPER_STARTING_CASH,
    positions: [], trades: [], createdAt: now, updatedAt: now,
  };
}

async function loadOrCreate(userId: string): Promise<PaperAccountRecord> {
  const existing = await getPaperAccount(userId);
  if (existing) return existing;
  const acct = newAccount(userId);
  await savePaperAccount(acct);
  return acct;
}

// Enrich positions with live price + market value for the response.
async function withValuation(account: PaperAccountRecord) {
  const quotes = await Promise.all(account.positions.map((p) => fetchQuoteForSymbol(p.ticker)));
  let positionsValue = 0;
  const positions = account.positions.map((p, i) => {
    const price = quotes[i]?.price ?? p.avgCost;
    const marketValue = price * p.shares;
    const costBasis = p.avgCost * p.shares;
    positionsValue += marketValue;
    return {
      ...p,
      price: +price.toFixed(2),
      marketValue: +marketValue.toFixed(2),
      pnl: +(marketValue - costBasis).toFixed(2),
      pnlPercent: +(((price - p.avgCost) / p.avgCost) * 100).toFixed(2),
    };
  });
  const equity = account.cash + positionsValue;
  const totalReturnPercent = +(((equity - account.startingCash) / account.startingCash) * 100).toFixed(2);
  return {
    cash: +account.cash.toFixed(2),
    startingCash: account.startingCash,
    positionsValue: +positionsValue.toFixed(2),
    equity: +equity.toFixed(2),
    totalReturnPercent,
    positions,
    trades: [...account.trades].reverse().slice(0, 50),
  };
}

export async function getPaperAccountController(req: Request, res: Response) {
  const account = await loadOrCreate(req.authUser!.id);
  return res.status(200).json(await withValuation(account));
}

export async function tradePaperController(req: Request, res: Response) {
  const userId = req.authUser!.id;
  const { ticker, side, shares, name } = req.body as { ticker?: string; side?: string; shares?: number; name?: string };

  if (!ticker || typeof ticker !== "string") return res.status(400).json({ error: "ticker required" });
  if (side !== "buy" && side !== "sell") return res.status(400).json({ error: "side must be 'buy' or 'sell'" });
  if (typeof shares !== "number" || !Number.isInteger(shares) || shares <= 0) {
    return res.status(400).json({ error: "shares must be a positive integer" });
  }

  const sym = ticker.toUpperCase();
  const quote = await fetchQuoteForSymbol(sym);
  if (!quote || quote.price <= 0) {
    return res.status(502).json({ error: `Live price unavailable for ${sym}.` });
  }
  const price = quote.price;
  const account = await loadOrCreate(userId);
  const positions = [...account.positions];
  const idx = positions.findIndex((p) => p.ticker === sym);

  if (side === "buy") {
    const cost = price * shares;
    if (cost > account.cash) {
      return res.status(400).json({ error: `Insufficient cash. Need ${cost.toFixed(2)}, have ${account.cash.toFixed(2)}.` });
    }
    account.cash -= cost;
    if (idx >= 0) {
      const p = positions[idx];
      const totalShares = p.shares + shares;
      positions[idx] = { ...p, shares: totalShares, avgCost: +(((p.avgCost * p.shares) + cost) / totalShares).toFixed(4) };
    } else {
      positions.push({ ticker: sym, name: name?.trim() || quote.name, shares, avgCost: +price.toFixed(4) });
    }
  } else {
    if (idx < 0 || positions[idx].shares < shares) {
      return res.status(400).json({ error: `Not enough shares of ${sym} to sell.` });
    }
    account.cash += price * shares;
    const remaining = positions[idx].shares - shares;
    if (remaining === 0) positions.splice(idx, 1);
    else positions[idx] = { ...positions[idx], shares: remaining };
  }

  account.positions = positions as PaperPosition[];
  account.trades.push({ id: randomUUID(), ticker: sym, side, shares, price: +price.toFixed(2), at: new Date().toISOString() });
  account.updatedAt = new Date().toISOString();
  await savePaperAccount(account);

  return res.status(200).json(await withValuation(account));
}

export async function resetPaperController(req: Request, res: Response) {
  const acct = newAccount(req.authUser!.id);
  await savePaperAccount(acct);
  return res.status(200).json(await withValuation(acct));
}
