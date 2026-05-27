import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import {
  getNotificationsController,
  markReadController,
  markAllReadController
} from "../controllers/notification.controller";

const notificationRoutes = Router();

notificationRoutes.use(authMiddleware);

notificationRoutes.get("/", getNotificationsController);
notificationRoutes.patch("/read-all", markAllReadController);
notificationRoutes.patch("/:id/read", markReadController);

export default notificationRoutes;
