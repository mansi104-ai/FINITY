import { Router } from "express";
import {
  getMarketHistoryController,
  getCandlesController,
  getMarketSnapshotController,
  getStocksController,
  getStockDetailController,
  getNewsController,
  searchStocksController,
  getEarningsController,
  getIpoCalendarController,
  getRecommendationsController,
} from "../controllers/market.controller";

const marketRoutes = Router();

marketRoutes.get("/snapshot", getMarketSnapshotController);
marketRoutes.get("/history/:ticker", getMarketHistoryController);
marketRoutes.get("/candles/:ticker", getCandlesController);
marketRoutes.get("/stocks", getStocksController);
marketRoutes.get("/stock/:ticker", getStockDetailController);
marketRoutes.get("/news", getNewsController);
marketRoutes.get("/search", searchStocksController);
marketRoutes.get("/earnings", getEarningsController);
marketRoutes.get("/ipo", getIpoCalendarController);
marketRoutes.get("/recommendations/:ticker", getRecommendationsController);

export default marketRoutes;
