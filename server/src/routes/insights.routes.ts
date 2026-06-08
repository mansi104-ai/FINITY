import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import {
  getPortfolioInsightsController,
  getMarketRegimeController,
} from "../controllers/insights.controller";

const insightsRoutes = Router();

// Public: market regime is general market context.
insightsRoutes.get("/regime", getMarketRegimeController);

// Auth-protected: portfolio analysis is per-user.
insightsRoutes.get("/portfolio", authMiddleware, getPortfolioInsightsController);

export default insightsRoutes;
