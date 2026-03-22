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
import { env } from "./config";

const app = express();

app.set("trust proxy", env.trustProxy);
app.disable("x-powered-by");
app.use(helmet());
app.use(
  cors({
    origin: env.corsOrigin === "*" ? true : env.corsOrigin,
    credentials: true
  }),
);
app.use(express.json({ limit: "100kb" }));
app.use(morgan(env.isProduction ? "combined" : "dev"));

app.get("/api/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "server", timestamp: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/market", marketRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/query", queryRoutes);
app.use("/api/reports", reportRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Avoid leaking internal details while still logging unexpected failures server-side.
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

if (!process.env.VERCEL) {
  app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on http://localhost:${env.port}`);
  });
}

export default app;
