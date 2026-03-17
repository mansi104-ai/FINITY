import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { env } from "../config";
import { db, findUserByEmail } from "../store/db";
import { toSafeUser, type UserRecord } from "../models/User.model";

const authRoutes = Router();

const authSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

function signToken(user: UserRecord): string {
  return jwt.sign({ sub: user.id, email: user.email }, env.jwtSecret, { expiresIn: "7d" });
}

authRoutes.post("/register", async (req, res) => {
  const parsed = authSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid registration payload", details: parsed.error.flatten() });
  }

  const email = parsed.data.email.toLowerCase();
  const existing = findUserByEmail(email);
  if (existing) {
    return res.status(409).json({ error: "Email already exists" });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);

  const user: UserRecord = {
    id: uuidv4(),
    email,
    passwordHash,
    budget: 10000,
    riskProfile: "medium",
    createdAt: new Date().toISOString()
  };

  db.users.set(user.id, user);

  return res.status(201).json({ token: signToken(user), user: toSafeUser(user) });
});

authRoutes.post("/login", async (req, res) => {
  const parsed = authSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid login payload", details: parsed.error.flatten() });
  }

  const user = findUserByEmail(parsed.data.email.toLowerCase());
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  return res.status(200).json({ token: signToken(user), user: toSafeUser(user) });
});

export default authRoutes;
