import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import {
  listAlertsController,
  createAlertController,
  deleteAlertController,
  checkAlertsController,
  cronCheckAlertsController,
} from "../controllers/alert.controller";

const alertRoutes = Router();

// Unauthenticated cron sweep (secret-gated) — must be registered BEFORE the auth
// middleware so Vercel Cron can reach it without a user session.
alertRoutes.get("/cron", cronCheckAlertsController);
alertRoutes.post("/cron", cronCheckAlertsController);

alertRoutes.use(authMiddleware);

alertRoutes.get("/", listAlertsController);
alertRoutes.post("/", createAlertController);
alertRoutes.post("/check", checkAlertsController);
alertRoutes.delete("/:id", deleteAlertController);

export default alertRoutes;
