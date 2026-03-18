import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config";
import { db } from "../store/db";

export type AuthPayload = {
  sub: string;
  email: string;
  sid: string;
  tv: number;
  typ: "access" | "refresh";
};

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = jwt.verify(token, env.jwtSecret, {
      issuer: env.jwtIssuer,
      audience: "finity-clients"
    }) as AuthPayload;

    if (payload.typ !== "access") {
      return res.status(401).json({ error: "Invalid token type" });
    }

    const user = db.users.get(payload.sub);

    if (!user) {
      return res.status(401).json({ error: "Session user not found" });
    }

    if (user.tokenVersion !== payload.tv) {
      return res.status(401).json({ error: "Token version mismatch" });
    }

    const session = db.authSessions.get(payload.sid);
    if (!session || session.userId !== user.id || session.revokedAt || +new Date(session.expiresAt) <= Date.now()) {
      return res.status(401).json({ error: "Session expired or revoked" });
    }

    req.authUser = { id: user.id, email: user.email };
    req.auth = {
      userId: user.id,
      email: user.email,
      sessionId: payload.sid,
      tokenVersion: payload.tv
    };
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}
