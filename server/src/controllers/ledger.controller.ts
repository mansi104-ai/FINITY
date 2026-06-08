import type { Request, Response } from "express";
import { randomUUID } from "crypto";
import { getLedger, saveLedger } from "../store/db";
import type { LedgerEntry, LedgerType } from "../models/Ledger.model";

function summarize(entries: LedgerEntry[]) {
  let income = 0, expense = 0;
  for (const e of entries) {
    if (e.type === "income") income += e.amount; else expense += e.amount;
  }
  return { income: +income.toFixed(2), expense: +expense.toFixed(2), net: +(income - expense).toFixed(2), count: entries.length };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function getLedgerController(req: Request, res: Response) {
  const userId = req.authUser!.id;
  const record = await getLedger(userId);
  const entries = (record?.entries ?? []).slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return res.status(200).json({ entries, summary: summarize(entries) });
}

export async function addLedgerEntryController(req: Request, res: Response) {
  const userId = req.authUser!.id;
  const { type, category, amount, note, date } = req.body as {
    type?: string; category?: string; amount?: number; note?: string; date?: string;
  };

  if (type !== "income" && type !== "expense") return res.status(400).json({ error: "type must be 'income' or 'expense'" });
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "amount must be a positive number" });
  const day = (date && ISO_DATE.test(date)) ? date : new Date().toISOString().slice(0, 10);

  const entry: LedgerEntry = {
    id: randomUUID(),
    type: type as LedgerType,
    category: (category?.trim() || (type === "income" ? "Income" : "Expense")).slice(0, 40),
    amount: +amount.toFixed(2),
    ...(note?.trim() ? { note: note.trim().slice(0, 200) } : {}),
    date: day,
    createdAt: new Date().toISOString(),
  };

  const record = await getLedger(userId);
  const entries = [...(record?.entries ?? []), entry].slice(-500); // cap per user
  await saveLedger({ userId, entries, updatedAt: new Date().toISOString() });
  return res.status(201).json({ entry });
}

export async function deleteLedgerEntryController(req: Request, res: Response) {
  const userId = req.authUser!.id;
  const id = String(req.params.id ?? "");
  if (!id) return res.status(400).json({ error: "id required" });
  const record = await getLedger(userId);
  const entries = (record?.entries ?? []).filter((e) => e.id !== id);
  await saveLedger({ userId, entries, updatedAt: new Date().toISOString() });
  return res.status(200).json({ ok: true });
}
