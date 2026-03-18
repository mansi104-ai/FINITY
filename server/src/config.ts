import { config } from "dotenv";
import path from "path";

// Load .env.local first (for local overrides), then .env
config({ path: path.resolve(__dirname, "../../.env.local") });
config();

export const env = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? "finity-dev-secret",
  pythonServiceUrl: process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000/run",
  queryLimitPerHour: Number(process.env.QUERY_LIMIT_PER_HOUR ?? 10)
};
