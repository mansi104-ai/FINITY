import { Router } from "express";
import { getReportController, listReportsController } from "../controllers/report.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const reportRoutes = Router();

reportRoutes.get("/", authMiddleware, listReportsController);
reportRoutes.get("/:id", authMiddleware, getReportController);

export default reportRoutes;
