import { Router } from "express";
import { runQueryController } from "../controllers/query.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { queryRateLimiter } from "../middleware/rateLimiter";

const queryRoutes = Router();

queryRoutes.post("/", authMiddleware, queryRateLimiter, runQueryController);

export default queryRoutes;
