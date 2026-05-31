import { Router } from "express";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET environment variable must be set in production");
  }
  console.warn("[auth] JWT_SECRET not set — using a random secret. Tokens will be invalidated on every server restart. Set JWT_SECRET in Replit Secrets for persistent sessions.");
}
export const JWT_SECRET = process.env.JWT_SECRET || randomBytes(32).toString("hex");

const SALT_ROUNDS = 10;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").toLowerCase();

// Simple in-memory rate limiter for auth endpoints (max 10 attempts per IP per 15 min)
const authAttempts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 15 * 60 * 1000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = authAttempts.get(ip);
  if (!record || record.resetAt < now) {
    authAttempts.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (record.count >= RATE_LIMIT) return false;
  record.count++;
  return true;
}

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
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  if (!checkRateLimit(ip)) return res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });

  const { name, email, password } = req.body || {};
  if (!name || typeof name !== "string" || name.length < 2) return res.status(400).json({ error: "Name must be at least 2 characters" });
  if (!email || typeof email !== "string" || !email.includes("@")) return res.status(400).json({ error: "Valid email required" });
  if (!password || typeof password !== "string" || password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  try {
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (existing.length > 0) return res.status(409).json({ error: "Email already registered" });
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const isAdmin = ADMIN_EMAIL !== "" && email.toLowerCase() === ADMIN_EMAIL;
    const plan = isAdmin ? "business" : "starter";
    const [user] = await db.insert(users).values({ name, email: email.toLowerCase(), passwordHash, plan, isAdmin }).returning();
    const token = signToken(user.id);
    return res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email, plan: user.plan, isAdmin: user.isAdmin } });
  } catch (err) {
    console.error("Signup error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/auth/login", async (req, res) => {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  if (!checkRateLimit(ip)) return res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });

  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });
  try {
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (!user) return res.status(401).json({ error: "Invalid email or password" });
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid email or password" });
    const token = signToken(user.id);
    return res.json({ token, user: { id: user.id, name: user.name, email: user.email, plan: user.plan, isAdmin: user.isAdmin } });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/auth/me", async (req, res) => {
  const payload = await verifyToken(req.headers.authorization);
  if (!payload) return res.status(401).json({ error: "Unauthorized" });
  try {
    const [user] = await db.select({ id: users.id, name: users.name, email: users.email, plan: users.plan, isAdmin: users.isAdmin, createdAt: users.createdAt }).from(users).where(eq(users.id, payload.userId)).limit(1);
    if (!user) return res.status(404).json({ error: "User not found" });
    return res.json({ user });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

router.patch("/auth/plan", async (req, res) => {
  const payload = await verifyToken(req.headers.authorization);
  if (!payload) return res.status(401).json({ error: "Unauthorized" });
  // Only admins can change plans — prevents users from upgrading themselves for free
  try {
    const [actor] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, payload.userId)).limit(1);
    if (!actor?.isAdmin) return res.status(403).json({ error: "Admin access required to change plans" });
    const { plan, targetUserId } = req.body;
    if (!["starter", "pro", "business"].includes(plan)) return res.status(400).json({ error: "Invalid plan" });
    const updateId = typeof targetUserId === "number" ? targetUserId : payload.userId;
    const [updated] = await db.update(users).set({ plan }).where(eq(users.id, updateId)).returning({ id: users.id, plan: users.plan });
    return res.json({ user: updated });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
