import type { RiskProfile } from "./User.model";

export type QueryStatus = "queued" | "running" | "completed" | "failed";

export interface QueryRecord {
  id: string;
  userId: string;
  rawQuery: string;
  ticker: string;
  version: number;
  status: QueryStatus;
  riskProfile: RiskProfile;
  budget: number;
  createdAt: string;
  updatedAt: string;
}
