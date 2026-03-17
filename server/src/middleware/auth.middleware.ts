import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config";
import { db } from "../store/db";

export type AuthPayload = {
  sub: string;
  email: string;
};

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = jwt.verify(token, env.jwtSecret) as AuthPayload;
    const user = db.users.get(payload.sub);

    if (!user) {
      return res.status(401).json({ error: "Session user not found" });
    }

    req.authUser = { id: user.id, email: user.email };
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}
