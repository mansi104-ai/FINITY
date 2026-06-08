export interface PaperPosition {
  ticker: string;
  name: string;
  shares: number;
  avgCost: number;
}

export interface PaperTrade {
  id: string;
  ticker: string;
  side: "buy" | "sell";
  shares: number;
  price: number;
  at: string;
}

export interface PaperAccountRecord {
  userId: string;
  cash: number;
  /** Cash deposited so the account was seeded with — used for total-return %. */
  startingCash: number;
  positions: PaperPosition[];
  trades: PaperTrade[];
  createdAt: string;
  updatedAt: string;
}

export const PAPER_STARTING_CASH = 100_000;
