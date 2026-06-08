export type LedgerType = "income" | "expense";

export interface LedgerEntry {
  id: string;
  type: LedgerType;
  category: string;
  amount: number;
  note?: string;
  /** ISO date (YYYY-MM-DD) the entry applies to. */
  date: string;
  createdAt: string;
}

export interface LedgerRecord {
  userId: string;
  entries: LedgerEntry[];
  updatedAt: string;
}
