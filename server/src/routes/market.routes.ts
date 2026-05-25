import { Router } from "express";
import {
  getMarketHistoryController,
  getMarketSnapshotController,
  getStocksController,
  getStockDetailController,
  getNewsController
} from "../controllers/market.controller";

const marketRoutes = Router();

marketRoutes.get("/snapshot", getMarketSnapshotController);
marketRoutes.get("/history/:ticker", getMarketHistoryController);
marketRoutes.get("/stocks", getStocksController);
marketRoutes.get("/stock/:ticker", getStockDetailController);
marketRoutes.get("/news", getNewsController);

export default marketRoutes;
