import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID, createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { env } from "../config";
import { authMiddleware } from "../middleware/auth.middleware";
import type { AuthSessionRecord } from "../models/AuthSession.model";
import { toSafeUser, type UserRecord } from "../models/User.model";
import {
  findUserByEmail,
  getSessionById,
  getUserById,
  revokeAllSessionsForUser,
  revokeSession,
  saveSession,
  saveUser,
} from "../store/db";

type TokenType = "access" | "refresh";

type JwtPayload = {
  sub: string;
  email: string;
  sid: string;
  tv: number;
  typ: TokenType;
};

const authRoutes = Router();

const authSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const refreshSchema = z.object({
  refreshToken: z.string().min(10)
});

function toTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function signToken(user: UserRecord, sessionId: string, type: TokenType): string {
  const expiresInSeconds =
    type === "access"
      ? Math.max(60, env.accessTokenTtlMinutes * 60)
      : Math.max(60, env.refreshTokenTtlDays * 24 * 60 * 60);

  const payload: JwtPayload = {
    sub: user.id,
    email: user.email,
    sid: sessionId,
    tv: user.tokenVersion,
    typ: type
  };

  return jwt.sign(payload, env.jwtSecret, {
    issuer: env.jwtIssuer,
    audience: "finity-clients",
    expiresIn: expiresInSeconds
  });
}

async function issueSessionTokens(user: UserRecord): Promise<{ accessToken: string; refreshToken: string }> {
  const now = new Date();
  const sessionId = randomUUID();
  const refreshToken = signToken(user, sessionId, "refresh");
  const refreshTokenHash = toTokenHash(refreshToken);
  const expiresAt = new Date(now.getTime() + env.refreshTokenTtlDays * 24 * 60 * 60 * 1000).toISOString();

  const session: AuthSessionRecord = {
    id: sessionId,
    userId: user.id,
    refreshTokenHash,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt
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

authRoutes.post("/register", async (req, res) => {
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
    id: uuidv4(),
    email,
    passwordHash,
    tokenVersion: 1,
    budget: 10000,
    riskProfile: "medium",
    createdAt: new Date().toISOString()
  };

  await saveUser(user);
  const tokens = await issueSessionTokens(user);

  return res.status(201).json({ ...tokens, user: toSafeUser(user) });
});

authRoutes.post("/login", async (req, res) => {
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
  return res.status(200).json({ ...tokens, user: toSafeUser(user) });
});

authRoutes.post("/refresh", async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid refresh payload", details: parsed.error.flatten() });
  }

  try {
    const payload = jwt.verify(parsed.data.refreshToken, env.jwtSecret, {
      issuer: env.jwtIssuer,
      audience: "finity-clients"
    }) as JwtPayload;

    if (payload.typ !== "refresh") {
      return res.status(401).json({ error: "Invalid token type" });
    }

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

    if (session.refreshTokenHash !== toTokenHash(parsed.data.refreshToken)) {
      revokeSession(session.id);
      return res.status(401).json({ error: "Refresh token mismatch" });
    }

    const rotatedRefreshToken = signToken(user, session.id, "refresh");
    const now = new Date().toISOString();
    await saveSession({
      ...session,
      refreshTokenHash: toTokenHash(rotatedRefreshToken),
      updatedAt: now
    });

    return res.status(200).json({
      accessToken: signToken(user, session.id, "access"),
      refreshToken: rotatedRefreshToken,
      user: toSafeUser(user)
    });
  } catch {
    return res.status(401).json({ error: "Invalid refresh token" });
  }
});

authRoutes.post("/logout", authMiddleware, async (req, res) => {
  if (!req.auth) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  await revokeSession(req.auth.sessionId);
  return res.status(200).json({ ok: true });
});

authRoutes.post("/logout-all", authMiddleware, async (req, res) => {
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
  await saveUser(updated);
  await revokeAllSessionsForUser(updated.id);

  return res.status(200).json({ ok: true });
});

export default authRoutes;
