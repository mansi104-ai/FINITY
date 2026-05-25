import { Router } from "express";
import {
  getMarketHistoryController,
  getMarketSnapshotController,
  getStocksController,
  getStockDetailController,
  getNewsController,
  searchStocksController
} from "../controllers/market.controller";

const marketRoutes = Router();

marketRoutes.get("/snapshot", getMarketSnapshotController);
marketRoutes.get("/history/:ticker", getMarketHistoryController);
marketRoutes.get("/stocks", getStocksController);
marketRoutes.get("/stock/:ticker", getStockDetailController);
marketRoutes.get("/news", getNewsController);
marketRoutes.get("/search", searchStocksController);

export default marketRoutes;
