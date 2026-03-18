import { Router } from "express";
import { runQueryController } from "../controllers/query.controller";
import { queryRateLimiter } from "../middleware/rateLimiter";

const queryRoutes = Router();

queryRoutes.post("/", queryRateLimiter, runQueryController);

export default queryRoutes;
