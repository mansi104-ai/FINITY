import { Router } from "express";
import {
  getMarketHistoryController,
  getMarketSnapshotController,
  getStocksController,
  getStockDetailController
} from "../controllers/market.controller";

const marketRoutes = Router();

marketRoutes.get("/snapshot", getMarketSnapshotController);
marketRoutes.get("/history/:ticker", getMarketHistoryController);
marketRoutes.get("/stocks", getStocksController);
marketRoutes.get("/stock/:ticker", getStockDetailController);

export default marketRoutes;
