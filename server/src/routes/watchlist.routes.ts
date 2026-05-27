import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import {
  getWatchlistController,
  addWatchlistItemController,
  removeWatchlistItemController,
  updateWatchlistItemController
} from "../controllers/watchlist.controller";

const watchlistRoutes = Router();

watchlistRoutes.use(authMiddleware);

watchlistRoutes.get("/", getWatchlistController);
watchlistRoutes.post("/", addWatchlistItemController);
watchlistRoutes.delete("/:ticker", removeWatchlistItemController);
watchlistRoutes.patch("/:ticker", updateWatchlistItemController);

export default watchlistRoutes;
