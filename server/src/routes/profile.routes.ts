import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.middleware";
import { getUserById, saveUser } from "../store/db";
import { toSafeUser } from "../models/User.model";

const profileRoutes = Router();

const profileSchema = z.object({
  budget: z.number().min(100).max(1_000_000),
  riskProfile: z.enum(["low", "medium", "high"])
});

profileRoutes.get("/", authMiddleware, async (req, res) => {
  const user = req.authUser ? await getUserById(req.authUser.id) : undefined;
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  return res.status(200).json({ user: toSafeUser(user) });
});

profileRoutes.patch("/", authMiddleware, async (req, res) => {
  const user = req.authUser ? await getUserById(req.authUser.id) : undefined;
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid profile payload", details: parsed.error.flatten() });
  }

  const updated = {
    ...user,
    budget: parsed.data.budget,
    riskProfile: parsed.data.riskProfile
  };

  await saveUser(updated);
  return res.status(200).json({ user: toSafeUser(updated) });
});

export default profileRoutes;
