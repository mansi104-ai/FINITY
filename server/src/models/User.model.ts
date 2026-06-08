export type RiskProfile = "low" | "medium" | "high";

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  tokenVersion: number;
  budget: number;
  riskProfile: RiskProfile;
  createdAt: string;
  /** TOTP 2FA. `totpPending` holds an unconfirmed secret during enrollment. */
  totpEnabled?: boolean;
  totpSecret?: string;
  totpPending?: string;
}

export interface SafeUser {
  id: string;
  email: string;
  budget: number;
  riskProfile: RiskProfile;
}

export function toSafeUser(user: UserRecord): SafeUser {
  return {
    id: user.id,
    email: user.email,
    budget: user.budget,
    riskProfile: user.riskProfile
  };
}
