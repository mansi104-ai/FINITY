import rateLimit from "express-rate-limit";
import { env } from "../config";

export const queryRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: env.queryLimitPerHour,
  keyGenerator: (req) => req.authUser?.id ?? req.ip ?? "anonymous",
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: `Rate limit reached: max ${env.queryLimitPerHour} queries per hour` }
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.authAttemptsPer15Minutes,
  keyGenerator: (req) => `${req.ip ?? "unknown"}:${String(req.body?.email ?? "").toLowerCase()}`,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: `Too many authentication attempts. Try again later.` }
});

export const authSessionRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.authAttemptsPer15Minutes * 2,
  keyGenerator: (req) => req.ip ?? "unknown",
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many session requests. Try again later." }
});
