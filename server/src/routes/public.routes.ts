import { Router } from "express";
import { getPublicReportController } from "../controllers/report.controller";

const publicRoutes = Router();

// Unauthenticated, read-only access to shared reports.
publicRoutes.get("/report/:slug", getPublicReportController);

export default publicRoutes;
