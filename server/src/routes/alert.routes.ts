import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import {
  listAlertsController,
  createAlertController,
  deleteAlertController,
  checkAlertsController,
} from "../controllers/alert.controller";

const alertRoutes = Router();

alertRoutes.use(authMiddleware);

alertRoutes.get("/", listAlertsController);
alertRoutes.post("/", createAlertController);
alertRoutes.post("/check", checkAlertsController);
alertRoutes.delete("/:id", deleteAlertController);

export default alertRoutes;
