import { Router } from "express";
import { getMarketHistoryController, getMarketSnapshotController } from "../controllers/market.controller";

const marketRoutes = Router();

marketRoutes.get("/snapshot", getMarketSnapshotController);
marketRoutes.get("/history/:ticker", getMarketHistoryController);

export default marketRoutes;
