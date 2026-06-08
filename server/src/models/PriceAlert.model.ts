export type AlertDirection = "above" | "below";

export interface PriceAlertRecord {
  id: string;
  userId: string;
  ticker: string;
  name: string;
  direction: AlertDirection;
  threshold: number;
  /** Once triggered, the alert is marked inactive so it fires only once. */
  active: boolean;
  createdAt: string;
  triggeredAt?: string;
  triggeredPrice?: number;
}
