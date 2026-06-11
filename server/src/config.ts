import { config } from "dotenv";
import path from "path";

const envSearchRoots = [
  path.resolve(__dirname, "../../../"),
  path.resolve(__dirname, "../../")
];

// Load repo-root env files first so local development works when the server is
// started from `server/` but shared env files live at the workspace root.
for (const root of envSearchRoots) {
  config({ path: path.join(root, ".env.local"), override: false });
  config({ path: path.join(root, ".env"), override: false });
}

function readNumber(value: string | undefined, fallback: number, key: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${key}: expected a positive number`);
  }
  return parsed;
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const jwtSecret = process.env.JWT_SECRET ?? "findec-dev-secret";
const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET ?? "findec-dev-refresh-secret";

function readString(value: string | undefined, fallback = ""): string {
  return (value ?? fallback).trim();
}

// In production, signing with the dev fallback secret is unsafe. By default we warn
// loudly (so we never brick a running deploy that hasn't set env vars yet). Set
// `ENFORCE_SECRETS=true` to upgrade this to a hard boot-time failure once secrets
// are provisioned.
const enforceSecrets = (process.env.ENFORCE_SECRETS ?? "").trim() === "true";
if (nodeEnv === "production") {
  const usingDefaultAccess = jwtSecret === "findec-dev-secret";
  const usingDefaultRefresh = jwtRefreshSecret === "findec-dev-refresh-secret";
  if (usingDefaultAccess || usingDefaultRefresh) {
    const which = [usingDefaultAccess && "JWT_SECRET", usingDefaultRefresh && "JWT_REFRESH_SECRET"]
      .filter(Boolean).join(" and ");
    if (enforceSecrets) {
      throw new Error(`${which} must be set in production — refusing to start with the dev fallback (ENFORCE_SECRETS=true).`);
    }
    console.warn(`WARNING: ${which} is the dev fallback in production. Set real secrets and ENFORCE_SECRETS=true.`);
  }
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
  queryLimitPerDay: readNumber(process.env.QUERY_LIMIT_PER_DAY, 4, "QUERY_LIMIT_PER_DAY"),
  authAttemptsPer15Minutes: readNumber(process.env.AUTH_ATTEMPTS_PER_15_MINUTES, 10, "AUTH_ATTEMPTS_PER_15_MINUTES"),
  trustProxy: readString(process.env.TRUST_PROXY) === "true",
  corsOrigin: readString(process.env.CORS_ORIGIN, "*"),
  mongodbUri: readString(process.env.MONGODB_URI),
  mongodbDbName: readString(process.env.MONGODB_DB_NAME, "findec"),
  databaseUrl: readString(process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? process.env.NEON_DATABASE_URL),
  newsApiKey: readString(process.env.NEWSAPI_KEY ?? process.env.NEWS_API_KEY),
  finnhubKey: readString(process.env.FINNHUB_API_KEY),
  twelvedataKey: readString(process.env.TWELVEDATA_API_KEY ?? process.env.TWELVE_DATA_API_KEY ?? process.env.TWELVEDATA_KEY),
  fmpKey: readString(process.env.FMP_API_KEY ?? process.env.FINANCIALMODELINGPREP_API_KEY),
  emailWebhookUrl: readString(process.env.EMAIL_WEBHOOK_URL),
  cronSecret: readString(process.env.CRON_SECRET),
  errorWebhookUrl: readString(process.env.ERROR_WEBHOOK_URL ?? process.env.SENTRY_DSN),
  appVersion: readString(process.env.APP_VERSION, "1.28.0")
};
