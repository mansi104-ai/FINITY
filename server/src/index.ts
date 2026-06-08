import "./config";

import compression from "compression";
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
import { startMorningDigestJobs } from "./jobs/morningDigest";
import { requestIdMiddleware } from "./middleware/requestId.middleware";
import { env } from "./config";
import { getDb } from "./store/db";

const app = express();
const VERSION = "0.0.6";

app.set("trust proxy", env.trustProxy);
app.disable("x-powered-by");

// Security middleware
app.use(helmet());
app.use(compression());
app.use(requestIdMiddleware);

// CORS - Permissive by default, strict only if explicitly configured
const corsOptions = {
  origin: env.corsOrigin === "*" ? true : env.corsOrigin.split(",").map(o => o.trim()),
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
  exposedHeaders: ["X-Request-ID", "Retry-After"],
  maxAge: 86400
};

app.use(cors(corsOptions));
app.use(express.json({ limit: "100kb" }));
app.use(morgan(env.isProduction ? "combined" : "dev"));

app.get("/api/health", async (req, res) => {
  try {
    const db = await getDb();
    res.status(200).json({
      ok: true,
      service: "server",
      version: VERSION,
      requestId: req.requestId,
      timestamp: new Date().toISOString(),
      dbConnected: Boolean(db),
      finnhubConfigured: Boolean(env.finnhubKey),
      mongodbConfigured: Boolean(env.mongodbUri)
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "Health check failed",
      requestId: req.requestId
    });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/market", marketRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/query", queryRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/watchlist", watchlistRoutes);
app.use("/api/notifications", notificationRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Log error server-side
  const errorMessage = err instanceof Error ? err.message : String(err);
  console.error({
    timestamp: new Date().toISOString(),
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    error: errorMessage
  });

  // Send response
  res.status(500).json({
    error: "Internal server error",
    requestId: req.requestId,
    timestamp: new Date().toISOString()
  });
});

if (!process.env.VERCEL) {
  app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on http://localhost:${env.port}`);
    startMorningDigestJobs();
  });
}

export default app;
