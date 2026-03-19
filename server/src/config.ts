import { config } from "dotenv";
import path from "path";

// Load .env.local first (for local overrides), then .env
config({ path: path.resolve(__dirname, "../../.env.local") });
config();

function readNumber(value: string | undefined, fallback: number, key: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${key}: expected a positive number`);
  }
  return parsed;
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const jwtSecret = process.env.JWT_SECRET ?? "finity-dev-secret";

if (nodeEnv === "production" && jwtSecret === "finity-dev-secret") {
  throw new Error("JWT_SECRET must be configured in production");
}

export const env = {
  nodeEnv,
  isProduction: nodeEnv === "production",
  port: readNumber(process.env.PORT, 4000, "PORT"),
  jwtSecret,
  jwtIssuer: process.env.JWT_ISSUER ?? "finity-server",
  accessTokenTtlMinutes: readNumber(process.env.ACCESS_TOKEN_TTL_MINUTES, 15, "ACCESS_TOKEN_TTL_MINUTES"),
  refreshTokenTtlDays: readNumber(process.env.REFRESH_TOKEN_TTL_DAYS, 30, "REFRESH_TOKEN_TTL_DAYS"),
  pythonServiceUrl: process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000/run",
  queryLimitPerHour: readNumber(process.env.QUERY_LIMIT_PER_HOUR, 10, "QUERY_LIMIT_PER_HOUR"),
  authAttemptsPer15Minutes: readNumber(process.env.AUTH_ATTEMPTS_PER_15_MINUTES, 10, "AUTH_ATTEMPTS_PER_15_MINUTES"),
  trustProxy: process.env.TRUST_PROXY === "true",
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  mongodbUri: process.env.MONGODB_URI ?? "",
  mongodbDbName: process.env.MONGODB_DB_NAME ?? "finity"
};
