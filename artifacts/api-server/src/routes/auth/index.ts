import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();
if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET environment variable must be set in production");
}
export const JWT_SECRET = process.env.JWT_SECRET || "dev_jwt_secret_change_in_production";
const SALT_ROUNDS = 10;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").toLowerCase();

export function signToken(userId: number) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
}

export async function verifyToken(authHeader: string | undefined): Promise<{ userId: number } | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(authHeader.slice(7), JWT_SECRET) as { userId: number };
  } catch { return null; }
}

router.post("/auth/signup", async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || typeof name !== "string" || name.length < 2) return res.status(400).json({ error: "Name must be at least 2 characters" });
  if (!email || typeof email !== "string" || !email.includes("@")) return res.status(400).json({ error: "Valid email required" });
  if (!password || typeof password !== "string" || password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
  try {
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (existing.length > 0) return res.status(409).json({ error: "Email already registered" });
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const isAdmin = ADMIN_EMAIL !== "" && email.toLowerCase() === ADMIN_EMAIL;
    const plan = isAdmin ? "business" : "starter";
    const [user] = await db.insert(users).values({ name, email: email.toLowerCase(), passwordHash, plan, isAdmin }).returning();
    const token = signToken(user.id);
    res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email, plan: user.plan, isAdmin: user.isAdmin } });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });
  try {
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (!user) return res.status(401).json({ error: "Invalid email or password" });
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid email or password" });
    const token = signToken(user.id);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, plan: user.plan, isAdmin: user.isAdmin } });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/auth/me", async (req, res) => {
  const payload = await verifyToken(req.headers.authorization);
  if (!payload) return res.status(401).json({ error: "Unauthorized" });
  try {
    const [user] = await db.select({ id: users.id, name: users.name, email: users.email, plan: users.plan, isAdmin: users.isAdmin, createdAt: users.createdAt }).from(users).where(eq(users.id, payload.userId)).limit(1);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

router.patch("/auth/plan", async (req, res) => {
  const payload = await verifyToken(req.headers.authorization);
  if (!payload) return res.status(401).json({ error: "Unauthorized" });
  const { plan } = req.body;
  if (!["starter", "pro", "business"].includes(plan)) return res.status(400).json({ error: "Invalid plan" });
  const [updated] = await db.update(users).set({ plan }).where(eq(users.id, payload.userId)).returning({ id: users.id, plan: users.plan });
  res.json({ user: updated });
});

export default router;
