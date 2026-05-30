import { Router } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { apiKeys, users } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev_jwt_secret_change_in_production";

async function requireAuth(req: any, res: any): Promise<{ userId: number; plan: string } | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Unauthorized" }); return null; }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as { userId: number };
    const [user] = await db.select({ id: users.id, plan: users.plan }).from(users).where(eq(users.id, payload.userId)).limit(1);
    if (!user) { res.status(401).json({ error: "User not found" }); return null; }
    return { userId: user.id, plan: user.plan };
  } catch { res.status(401).json({ error: "Invalid token" }); return null; }
}

router.get("/api/keys", async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const keys = await db.select({ id: apiKeys.id, name: apiKeys.name, keyPrefix: apiKeys.keyPrefix, createdAt: apiKeys.createdAt, lastUsedAt: apiKeys.lastUsedAt }).from(apiKeys).where(eq(apiKeys.userId, auth.userId));
  res.json({ keys });
});

router.post("/api/keys", async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  if (auth.plan === "starter") return res.status(403).json({ error: "API keys require a Pro or Business plan" });

  const { name } = req.body || {};
  if (!name || typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "Key name required" });

  const rawKey = `sk-ai-${crypto.randomBytes(24).toString("hex")}`;
  const keyHash = await bcrypt.hash(rawKey, 8);
  const keyPrefix = rawKey.slice(0, 12);

  const [created] = await db.insert(apiKeys).values({ userId: auth.userId, name: name.trim(), keyHash, keyPrefix }).returning({ id: apiKeys.id, name: apiKeys.name, keyPrefix: apiKeys.keyPrefix, createdAt: apiKeys.createdAt });
  res.status(201).json({ key: { ...created, rawKey } });
});

router.delete("/api/keys/:id", async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const keyId = parseInt(req.params.id);
  if (isNaN(keyId)) return res.status(400).json({ error: "Invalid id" });
  await db.delete(apiKeys).where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, auth.userId)));
  res.json({ success: true });
});

router.patch("/api/auth/plan", async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const { plan } = req.body;
  if (!["starter", "pro", "business"].includes(plan)) return res.status(400).json({ error: "Invalid plan" });
  const [updated] = await db.update(users).set({ plan }).where(eq(users.id, auth.userId)).returning({ id: users.id, plan: users.plan });
  res.json({ user: updated });
});

export default router;
