export interface AuthSessionRecord {
  id: string;
  userId: string;
  refreshTokenHash: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  revokedAt?: string;
}
