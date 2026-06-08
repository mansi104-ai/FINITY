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

function readString(value: string | undefined, fallback = ""): string {
  return (value ?? fallback).trim();
}

const jwtSecret = readString(process.env.JWT_SECRET, "findec-dev-secret-change-in-production");
const jwtRefreshSecret = readString(process.env.JWT_REFRESH_SECRET, "findec-dev-refresh-secret-change-in-production");

if (nodeEnv === "production" && jwtSecret.includes("change-in-production")) {
  throw new Error(`FATAL: JWT_SECRET must be configured in production. Set it as an environment variable.`);
}

if (nodeEnv === "production" && jwtRefreshSecret.includes("change-in-production")) {
  throw new Error(`FATAL: JWT_REFRESH_SECRET must be configured in production. Set it as an environment variable.`);
}

export const env = {
  nodeEnv,
  isProduction: nodeEnv === "production",
  port: readNumber(process.env.PORT, 4000, "PORT"),
  jwtSecret,
  jwtRefreshSecret,
  jwtIssuer: readString(process.env.JWT_ISSUER, "findec-server"),
  accessTokenTtlSeconds: readNumber(process.env.ACCESS_TOKEN_TTL, 900, "ACCESS_TOKEN_TTL"),
  refreshTokenTtlSeconds: readNumber(process.env.REFRESH_TOKEN_TTL, 604800, "REFRESH_TOKEN_TTL"),
  pythonServiceUrl: readString(process.env.PYTHON_SERVICE_URL, "http://localhost:8000/run"),
  queryLimitPerHour: readNumber(process.env.QUERY_LIMIT_PER_HOUR, 10, "QUERY_LIMIT_PER_HOUR"),
  authAttemptsPer15Minutes: readNumber(process.env.AUTH_ATTEMPTS_PER_15_MINUTES, 10, "AUTH_ATTEMPTS_PER_15_MINUTES"),
  trustProxy: readString(process.env.TRUST_PROXY) === "true",
  corsOrigin: readString(process.env.CORS_ORIGIN, "*"),
  mongodbUri: readString(process.env.MONGODB_URI),
  mongodbDbName: readString(process.env.MONGODB_DB_NAME, "findec"),
  newsApiKey: readString(process.env.NEWSAPI_KEY ?? process.env.NEWS_API_KEY),
  finnhubKey: readString(process.env.FINNHUB_API_KEY)
};

export const env = {
  nodeEnv,
  isProduction: nodeEnv === "production",
  port: readNumber(process.env.PORT, 4000, "PORT"),
  jwtSecret,
  jwtRefreshSecret,
  jwtIssuer: readString(process.env.JWT_ISSUER, "findec-server"),
  accessTokenTtlSeconds: readNumber(process.env.ACCESS_TOKEN_TTL, 900, "ACCESS_TOKEN_TTL"),
  refreshTokenTtlSeconds: readNumber(process.env.REFRESH_TOKEN_TTL, 604800, "REFRESH_TOKEN_TTL"),
  pythonServiceUrl: readString(process.env.PYTHON_SERVICE_URL, "http://localhost:8000/run"),
  queryLimitPerHour: readNumber(process.env.QUERY_LIMIT_PER_HOUR, 10, "QUERY_LIMIT_PER_HOUR"),
  authAttemptsPer15Minutes: readNumber(process.env.AUTH_ATTEMPTS_PER_15_MINUTES, 10, "AUTH_ATTEMPTS_PER_15_MINUTES"),
  trustProxy: readString(process.env.TRUST_PROXY) === "true",
  corsOrigin: readString(process.env.CORS_ORIGIN, "*"),
  mongodbUri: readString(process.env.MONGODB_URI),
  mongodbDbName: readString(process.env.MONGODB_DB_NAME, "findec"),
  newsApiKey: readString(process.env.NEWSAPI_KEY ?? process.env.NEWS_API_KEY),
  finnhubKey: readString(process.env.FINNHUB_API_KEY)
};
