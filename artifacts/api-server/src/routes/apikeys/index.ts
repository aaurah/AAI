import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { apiKeys, users } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { verifyToken } from "../auth";

const router = Router();

async function requireAuth(req: any, res: any): Promise<{ userId: number; plan: string } | null> {
  const payload = await verifyToken(req.headers.authorization);
  if (!payload) { res.status(401).json({ error: "Unauthorized" }); return null; }
  const [user] = await db.select({ id: users.id, plan: users.plan }).from(users).where(eq(users.id, payload.userId)).limit(1);
  if (!user) { res.status(401).json({ error: "User not found" }); return null; }
  return { userId: user.id, plan: user.plan };
}

router.get("/keys", async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  try {
    const keys = await db.select({ id: apiKeys.id, name: apiKeys.name, keyPrefix: apiKeys.keyPrefix, createdAt: apiKeys.createdAt, lastUsedAt: apiKeys.lastUsedAt }).from(apiKeys).where(eq(apiKeys.userId, auth.userId));
    return res.json({ keys });
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/keys", async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  if (auth.plan === "starter") return res.status(403).json({ error: "API keys require a Pro or Business plan" });
  const { name } = req.body || {};
  if (!name || typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "Key name required" });
  try {
    const rawKey = `sk-ai-${crypto.randomBytes(24).toString("hex")}`;
    const keyHash = await bcrypt.hash(rawKey, 12);
    const keyPrefix = rawKey.slice(0, 12);
    const [created] = await db.insert(apiKeys).values({ userId: auth.userId, name: name.trim(), keyHash, keyPrefix }).returning({ id: apiKeys.id, name: apiKeys.name, keyPrefix: apiKeys.keyPrefix, createdAt: apiKeys.createdAt });
    // rawKey shown only once — never stored in plaintext
    return res.status(201).json({ key: { ...created, rawKey } });
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/keys/:id", async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const keyId = parseInt(req.params.id);
  if (isNaN(keyId)) return res.status(400).json({ error: "Invalid id" });
  try {
    await db.delete(apiKeys).where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, auth.userId)));
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
