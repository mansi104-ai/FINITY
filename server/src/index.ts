import "./config";

import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import authRoutes from "./routes/auth.routes";
import marketRoutes from "./routes/market.routes";
import profileRoutes from "./routes/profile.routes";
import queryRoutes from "./routes/query.routes";
import reportRoutes from "./routes/report.routes";
import watchlistRoutes from "./routes/watchlist.routes";
import notificationRoutes from "./routes/notification.routes";
import alertRoutes from "./routes/alert.routes";
import insightsRoutes from "./routes/insights.routes";
import paperRoutes from "./routes/paper.routes";
import ledgerRoutes from "./routes/ledger.routes";
import publicRoutes from "./routes/public.routes";
import waitlistRoutes from "./routes/waitlist.routes";
import { startMorningDigestJobs } from "./jobs/morningDigest";
import { apiWriteRateLimiter } from "./middleware/rateLimiter";
import { openapiSpec, swaggerHtml } from "./openapi";
import { reportError } from "./services/errorReporter";
import { env } from "./config";

const app = express();
const bootedAt = Date.now();

app.set("trust proxy", env.trustProxy);
app.disable("x-powered-by");
app.use(
  helmet({
    // API is JSON-only and cross-origin (separate client deploy); relax CSP/COEP that
    // would otherwise block the SPA, but keep the security-relevant headers strict.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    referrerPolicy: { policy: "no-referrer" },
    hsts: env.isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
  })
);
app.use(
  cors({
    origin: env.corsOrigin === "*" ? true : env.corsOrigin,
    credentials: true
  }),
);
app.use(express.json({ limit: "100kb" }));
app.use(morgan(env.isProduction ? "combined" : "dev"));

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "server",
    version: env.appVersion,
    uptimeSeconds: Math.floor((Date.now() - bootedAt) / 1000),
    timestamp: new Date().toISOString(),
  });
});

// ── API docs (OpenAPI 3.0 + Swagger UI) ──
app.get("/api/openapi.json", (_req, res) => res.status(200).json(openapiSpec));
app.get("/api/docs", (_req, res) => res.status(200).type("html").send(swaggerHtml));

app.use("/api/auth", authRoutes);
app.use("/api/market", marketRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/query", queryRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/watchlist", watchlistRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/alerts", apiWriteRateLimiter, alertRoutes);
app.use("/api/insights", insightsRoutes);
app.use("/api/paper", apiWriteRateLimiter, paperRoutes);
app.use("/api/ledger", apiWriteRateLimiter, ledgerRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/waitlist", apiWriteRateLimiter, waitlistRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Avoid leaking internal details while still logging + reporting unexpected failures.
  reportError(err, { method: req.method, path: req.path });
  res.status(500).json({ error: "Internal server error" });
});

if (!process.env.VERCEL) {
  app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on http://localhost:${env.port}`);
    startMorningDigestJobs();
  });
}

export default app;
