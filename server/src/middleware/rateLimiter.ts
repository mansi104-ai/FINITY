import rateLimit from "express-rate-limit";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config";

const queryWindowMs = 60 * 60 * 1000;
const queryUserBuckets = new Map<string, number[]>();
let cleanupIntervalId: NodeJS.Timeout | null = null;

function pruneWindow(timestamps: number[], now: number): number[] {
  return timestamps.filter((timestamp) => now - timestamp < queryWindowMs);
}

// Start cleanup job to prevent memory leak
function startCleanupJob() {
  if (cleanupIntervalId) return;
  
  cleanupIntervalId = setInterval(() => {
    const now = Date.now();
    for (const [userId, timestamps] of queryUserBuckets.entries()) {
      const pruned = pruneWindow(timestamps, now);
      if (pruned.length === 0) {
        queryUserBuckets.delete(userId);
      } else if (pruned.length !== timestamps.length) {
        queryUserBuckets.set(userId, pruned);
      }
    }
  }, 5 * 60 * 1000); // Cleanup every 5 minutes
}

startCleanupJob();

export function queryRateLimiter(req: Request, res: Response, next: NextFunction) {
  const userId = req.authUser?.id;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const now = Date.now();
  const history = pruneWindow(queryUserBuckets.get(userId) ?? [], now);

  if (history.length >= env.queryLimitPerHour) {
    const retryAfterSeconds = Math.max(1, Math.ceil((queryWindowMs - (now - history[0])) / 1000));
    res.setHeader("Retry-After", retryAfterSeconds.toString());
    return res.status(429).json({
      error: `Rate limit reached: max ${env.queryLimitPerHour} queries per hour`,
      retryAfter: retryAfterSeconds
    });
  }

  history.push(now);
  queryUserBuckets.set(userId, history);
  return next();
}

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
