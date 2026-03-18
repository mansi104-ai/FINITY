import { Router } from "express";
import { getReportController, listReportsController } from "../controllers/report.controller";

const reportRoutes = Router();

reportRoutes.get("/", listReportsController);
reportRoutes.get("/:id", getReportController);

export default reportRoutes;
