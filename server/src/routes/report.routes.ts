import { Router } from "express";
import { getReportController, listReportsController, shareReportController } from "../controllers/report.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const reportRoutes = Router();

reportRoutes.get("/", authMiddleware, listReportsController);
reportRoutes.get("/:id", authMiddleware, getReportController);
reportRoutes.post("/:id/share", authMiddleware, shareReportController);

export default reportRoutes;
