import { Router } from "express";
import { getMarketSnapshotController } from "../controllers/market.controller";

const marketRoutes = Router();

marketRoutes.get("/snapshot", getMarketSnapshotController);

export default marketRoutes;
