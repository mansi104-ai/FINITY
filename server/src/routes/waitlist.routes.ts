import { Router } from "express";
import type { Request, Response } from "express";
import { saveWaitlistEntry, countWaitlistEntries } from "../store/db";

const waitlistRoutes = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Public — capture Pro-tier interest (monetization intent). Rate-limited at the
// app level via apiWriteRateLimiter.
waitlistRoutes.post("/", async (req: Request, res: Response) => {
  const { email, plan } = req.body as { email?: string; plan?: string };
  if (!email || typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: "A valid email is required." });
  }
  const chosenPlan = typeof plan === "string" && plan.trim() ? plan.trim().slice(0, 32) : "pro";
  try {
    const { alreadyOn } = await saveWaitlistEntry(email, chosenPlan, {
      ua: String(req.headers["user-agent"] ?? "").slice(0, 200),
      cc: String((req.headers["x-vercel-ip-country"] as string) ?? ""),
    });
    return res.status(200).json({ ok: true, alreadyOn });
  } catch {
    return res.status(500).json({ error: "Could not join the waitlist right now. Please try again." });
  }
});

// Public count so the page can show social proof ("N people waiting").
waitlistRoutes.get("/count", async (_req: Request, res: Response) => {
  try {
    return res.status(200).json({ count: await countWaitlistEntries() });
  } catch {
    return res.status(200).json({ count: 0 });
  }
});

export default waitlistRoutes;
