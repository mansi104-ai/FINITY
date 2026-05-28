import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID, createHash } from "crypto";
import { z } from "zod";
import { env } from "../config";
import { authMiddleware } from "../middleware/auth.middleware";
import { authRateLimiter, authSessionRateLimiter } from "../middleware/rateLimiter";
import type { AuthSessionRecord } from "../models/AuthSession.model";
import { toSafeUser, type UserRecord } from "../models/User.model";
import {
  findUserByEmail,
  getDb,
  getSessionById,
  getUserById,
  isRefreshTokenRevoked,
  revokeRefreshToken,
  revokeAllSessionsForUser,
  revokeSession,
  saveSession,
  saveUser,
} from "../store/db";
import type { RevokedRefreshTokenRecord } from "../models/RevokedRefreshToken.model";

type TokenType = "access" | "refresh";

type JwtPayload = {
  sub: string;
  email: string;
  sid: string;
  tv: number;
  typ: TokenType;
  jti: string;
  exp?: number;
};

const authRoutes = Router();

const authSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(8)
});

const REFRESH_COOKIE_NAME = "refreshToken";

async function ensureAuthPersistence(res: Response): Promise<boolean> {
  if (!env.isProduction) return true;
  // If no MongoDB URI is configured, fall through to in-memory store (data lost on restart but auth works).
  if (!env.mongodbUri) return true;
  const db = await getDb();
  if (db) return true;
  res.status(503).json({ error: "Authentication is temporarily unavailable because the database is not connected." });
  return false;
}

function toTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function signToken(user: UserRecord, sessionId: string, type: TokenType): string {
  const payload: JwtPayload = {
    sub: user.id,
    email: user.email,
    sid: sessionId,
    tv: user.tokenVersion,
    typ: type,
    jti: randomUUID()
  };

  return jwt.sign(payload, type === "access" ? env.jwtSecret : env.jwtRefreshSecret, {
    issuer: env.jwtIssuer,
    audience: "findec-clients",
    expiresIn: type === "access" ? "15m" : Math.max(60, env.refreshTokenTtlSeconds)
  });
}

async function issueSessionTokens(user: UserRecord): Promise<{ accessToken: string; refreshToken: string }> {
  const now = new Date();
  const sessionId = randomUUID();
  // Access and refresh tokens share one session id so revocation invalidates the whole session.
  const refreshToken = signToken(user, sessionId, "refresh");
  const refreshTokenHash = toTokenHash(refreshToken);
  const expiresAt = new Date(now.getTime() + env.refreshTokenTtlSeconds * 1000).toISOString();

  const session: AuthSessionRecord = {
    id: sessionId,
    userId: user.id,
    refreshTokenHash,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt,
  };

  await saveSession(session);

  return {
    accessToken: signToken(user, sessionId, "access"),
    refreshToken
  };
}

function isSessionActive(session: AuthSessionRecord): boolean {
  if (session.revokedAt) {
    return false;
  }
  return +new Date(session.expiresAt) > Date.now();
}

function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) {
    return undefined;
  }

  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return undefined;
}

function getRefreshTokenFromRequest(req: Request): string | undefined {
  const bodyToken = typeof req.body?.refreshToken === "string" ? req.body.refreshToken.trim() : "";
  if (bodyToken) {
    return bodyToken;
  }

  return readCookie(req, REFRESH_COOKIE_NAME);
}

function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction,
    maxAge: env.refreshTokenTtlSeconds * 1000,
    path: "/api/auth"
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction,
    path: "/api/auth"
  });
}

async function revokeRefreshTokenRecord(token: string, payload: JwtPayload): Promise<void> {
  const record: RevokedRefreshTokenRecord = {
    tokenHash: toTokenHash(token),
    sessionId: payload.sid,
    userId: payload.sub,
    revokedAt: new Date().toISOString(),
    expiresAt: new Date(
      ("exp" in payload && typeof payload.exp === "number"
        ? payload.exp * 1000
        : Date.now() + env.refreshTokenTtlSeconds * 1000)
    ).toISOString()
  };
  await revokeRefreshToken(record);
}

async function verifyRefreshToken(refreshToken: string): Promise<JwtPayload> {
  const tokenHash = toTokenHash(refreshToken);
  if (await isRefreshTokenRevoked(tokenHash)) {
    throw new jwt.JsonWebTokenError("Refresh token revoked");
  }

  const payload = jwt.verify(refreshToken, env.jwtRefreshSecret, {
    issuer: env.jwtIssuer,
    audience: "findec-clients"
  }) as JwtPayload;

  if (payload.typ !== "refresh") {
    throw new jwt.JsonWebTokenError("Invalid token type");
  }

  return payload;
}

authRoutes.post("/register", authRateLimiter, async (req, res, next) => {
  try {
    if (!(await ensureAuthPersistence(res))) {
      return;
    }

    const parsed = authSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid registration payload", details: parsed.error.flatten() });
    }

    const email = parsed.data.email.toLowerCase();
    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: "Email already exists" });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 10);

    const user: UserRecord = {
      id: randomUUID(),
      email,
      passwordHash,
      tokenVersion: 1,
      budget: 10000,
      riskProfile: "medium",
      createdAt: new Date().toISOString()
    };

    await saveUser(user);
    // Registration immediately creates a live session so the frontend can continue without a second login step.
    const tokens = await issueSessionTokens(user);

    setRefreshCookie(res, tokens.refreshToken);
    return res.status(201).json({ ...tokens, user: toSafeUser(user) });
  } catch (error) {
    return next(error);
  }
});

authRoutes.post("/login", authRateLimiter, async (req, res, next) => {
  try {
    if (!(await ensureAuthPersistence(res))) {
      return;
    }

    const parsed = authSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid login payload", details: parsed.error.flatten() });
    }

    const user = await findUserByEmail(parsed.data.email.toLowerCase());
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const tokens = await issueSessionTokens(user);
    setRefreshCookie(res, tokens.refreshToken);
    return res.status(200).json({ ...tokens, user: toSafeUser(user) });
  } catch (error) {
    return next(error);
  }
});

authRoutes.post("/refresh", authSessionRateLimiter, async (req, res, next) => {
  try {
    if (!(await ensureAuthPersistence(res))) {
      return;
    }

    const refreshToken = getRefreshTokenFromRequest(req);
    if (!refreshToken) {
      return res.status(400).json({ error: "Missing refresh token" });
    }

    try {
      const payload = await verifyRefreshToken(refreshToken);

      const user = await getUserById(payload.sub);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      if (user.tokenVersion !== payload.tv) {
        return res.status(401).json({ error: "Session version mismatch" });
      }

      const session = await getSessionById(payload.sid);
      if (!session || session.userId !== user.id || !isSessionActive(session)) {
        return res.status(401).json({ error: "Session is invalid or expired" });
      }

      if (session.refreshTokenHash !== toTokenHash(refreshToken)) {
        // A refresh token mismatch usually means replay or a stale client token, so revoke the session defensively.
        await revokeRefreshTokenRecord(refreshToken, payload);
        await revokeSession(session.id);
        return res.status(401).json({ error: "Refresh token mismatch" });
      }

      // Rotate refresh tokens on every refresh so an old leaked token cannot be reused indefinitely.
      const rotatedRefreshToken = signToken(user, session.id, "refresh");
      const now = new Date().toISOString();
      await revokeRefreshTokenRecord(refreshToken, payload);
      await saveSession({
        ...session,
        refreshTokenHash: toTokenHash(rotatedRefreshToken),
        updatedAt: now
      });

      setRefreshCookie(res, rotatedRefreshToken);
      return res.status(200).json({
        accessToken: signToken(user, session.id, "access"),
        refreshToken: rotatedRefreshToken,
        user: toSafeUser(user)
      });
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
        return res.status(401).json({ error: "Invalid refresh token" });
      }
      return next(error);
    }
  } catch (error) {
    return next(error);
  }
});

authRoutes.post("/logout", authSessionRateLimiter, authMiddleware, async (req, res, next) => {
  try {
    if (!(await ensureAuthPersistence(res))) {
      return;
    }

    if (!req.auth) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const refreshToken = getRefreshTokenFromRequest(req);
    if (refreshToken) {
      try {
        const payload = await verifyRefreshToken(refreshToken);
        await revokeRefreshTokenRecord(refreshToken, payload);
      } catch {
        // Logout should still revoke the current session even if the client sent a stale refresh token.
      }
    }

    await revokeSession(req.auth.sessionId);
    clearRefreshCookie(res);
    return res.status(200).json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

authRoutes.post("/logout-all", authSessionRateLimiter, authMiddleware, async (req, res, next) => {
  try {
    if (!(await ensureAuthPersistence(res))) {
      return;
    }

    if (!req.authUser) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await getUserById(req.authUser.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const updated: UserRecord = {
      ...user,
      tokenVersion: user.tokenVersion + 1
    };
    // Bumping tokenVersion invalidates all previously signed access/refresh tokens for the user.
    await saveUser(updated);
    await revokeAllSessionsForUser(updated.id);

    return res.status(200).json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

export default authRoutes;
