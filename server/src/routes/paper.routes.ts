import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import {
  getPaperAccountController,
  tradePaperController,
  resetPaperController,
} from "../controllers/paper.controller";

const paperRoutes = Router();

paperRoutes.use(authMiddleware);

paperRoutes.get("/", getPaperAccountController);
paperRoutes.post("/trade", tradePaperController);
paperRoutes.post("/reset", resetPaperController);

export default paperRoutes;
