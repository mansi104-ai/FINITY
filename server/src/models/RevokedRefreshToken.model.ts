export interface RevokedRefreshTokenRecord {
  tokenHash: string;
  sessionId: string;
  userId: string;
  revokedAt: string;
  expiresAt: string;
}
