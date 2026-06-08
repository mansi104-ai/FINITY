import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import {
  getLedgerController,
  addLedgerEntryController,
  deleteLedgerEntryController,
} from "../controllers/ledger.controller";

const ledgerRoutes = Router();

ledgerRoutes.use(authMiddleware);

ledgerRoutes.get("/", getLedgerController);
ledgerRoutes.post("/", addLedgerEntryController);
ledgerRoutes.delete("/:id", deleteLedgerEntryController);

export default ledgerRoutes;
