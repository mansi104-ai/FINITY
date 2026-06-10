export type AlertDirection = "above" | "below";

/**
 * How often the user wants to be reminded once the condition is met:
 * - "once"  → fire a single time, then deactivate (default).
 * - "daily" → keep the alert active and re-notify at most once per day while
 *             the price still satisfies the condition (a recurring reminder).
 */
export type AlertCadence = "once" | "daily";

export interface PriceAlertRecord {
  id: string;
  userId: string;
  ticker: string;
  name: string;
  direction: AlertDirection;
  threshold: number;
  /** Once triggered, the alert is marked inactive so it fires only once. */
  active: boolean;
  cadence?: AlertCadence;
  createdAt: string;
  triggeredAt?: string;
  triggeredPrice?: number;
  /** Last time a notification was emitted (used to throttle "daily" alerts). */
  lastNotifiedAt?: string;
}
