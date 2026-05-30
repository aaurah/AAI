import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev_jwt_secret_change_in_production";
const SALT_ROUNDS = 10;

function signToken(userId: number) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
}

router.post("/api/auth/signup", async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || typeof name !== "string" || name.length < 2) return res.status(400).json({ error: "Name must be at least 2 characters" });
  if (!email || typeof email !== "string" || !email.includes("@")) return res.status(400).json({ error: "Valid email required" });
  if (!password || typeof password !== "string" || password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
  try {
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (existing.length > 0) return res.status(409).json({ error: "Email already registered" });
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const [user] = await db.insert(users).values({ name, email: email.toLowerCase(), passwordHash, plan: "starter" }).returning();
    const token = signToken(user.id);
    res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email, plan: user.plan } });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });
  try {
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (!user) return res.status(401).json({ error: "Invalid email or password" });
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid email or password" });
    const token = signToken(user.id);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, plan: user.plan } });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/api/auth/me", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "No token" });
  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as { userId: number };
    const [user] = await db.select({ id: users.id, name: users.name, email: users.email, plan: users.plan, createdAt: users.createdAt }).from(users).where(eq(users.id, payload.userId)).limit(1);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user });
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});

export default router;
