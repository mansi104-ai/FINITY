import rateLimit from "express-rate-limit";
import { env } from "../config";

export const queryRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: env.queryLimitPerHour,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: `Rate limit reached: max ${env.queryLimitPerHour} queries per hour` }
});
