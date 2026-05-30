import { Router } from "express";
import { db } from "@workspace/db";
import { users, apiKeys } from "@workspace/db/schema";
import { conversations, messages } from "@workspace/db/schema";
import { eq, desc, count, sql } from "drizzle-orm";
import { verifyToken } from "../auth";

const router = Router();

async function requireAdmin(req: any, res: any): Promise<{ userId: number } | null> {
  const payload = await verifyToken(req.headers.authorization);
  if (!payload) { res.status(401).json({ error: "Unauthorized" }); return null; }
  const [user] = await db.select({ id: users.id, isAdmin: users.isAdmin }).from(users).where(eq(users.id, payload.userId)).limit(1);
  if (!user?.isAdmin) { res.status(403).json({ error: "Admin access required" }); return null; }
  return { userId: user.id };
}

router.get("/admin/stats", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  try {
    const [userCount] = await db.select({ count: count() }).from(users);
    const [convCount] = await db.select({ count: count() }).from(conversations);
    const [msgCount] = await db.select({ count: count() }).from(messages);
    const [keyCount] = await db.select({ count: count() }).from(apiKeys);
    const planBreakdown = await db.select({ plan: users.plan, count: count() }).from(users).groupBy(users.plan);
    res.json({
      users: userCount.count,
      conversations: convCount.count,
      messages: msgCount.count,
      apiKeys: keyCount.count,
      planBreakdown,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/admin/users", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  try {
    const search = (req.query.search as string || "").toLowerCase();
    const allUsers = await db.select({ id: users.id, name: users.name, email: users.email, plan: users.plan, isAdmin: users.isAdmin, createdAt: users.createdAt }).from(users).orderBy(desc(users.createdAt));
    const filtered = search ? allUsers.filter(u => u.name.toLowerCase().includes(search) || u.email.toLowerCase().includes(search)) : allUsers;
    res.json({ users: filtered });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

router.patch("/admin/users/:id/plan", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const userId = parseInt(req.params.id);
  if (isNaN(userId)) return res.status(400).json({ error: "Invalid id" });
  const { plan } = req.body;
  if (!["starter", "pro", "business"].includes(plan)) return res.status(400).json({ error: "Invalid plan" });
  const [updated] = await db.update(users).set({ plan }).where(eq(users.id, userId)).returning({ id: users.id, plan: users.plan });
  res.json({ user: updated });
});

router.patch("/admin/users/:id/admin", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const userId = parseInt(req.params.id);
  if (isNaN(userId)) return res.status(400).json({ error: "Invalid id" });
  if (userId === admin.userId) return res.status(400).json({ error: "Cannot change your own admin status" });
  const { isAdmin } = req.body;
  const [updated] = await db.update(users).set({ isAdmin: !!isAdmin }).where(eq(users.id, userId)).returning({ id: users.id, isAdmin: users.isAdmin });
  res.json({ user: updated });
});

router.delete("/admin/users/:id", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const userId = parseInt(req.params.id);
  if (isNaN(userId)) return res.status(400).json({ error: "Invalid id" });
  if (userId === admin.userId) return res.status(400).json({ error: "Cannot delete your own account" });
  await db.delete(apiKeys).where(eq(apiKeys.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  res.json({ success: true });
});

router.get("/admin/conversations", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  try {
    const convs = await db.select({ id: conversations.id, title: conversations.title, createdAt: conversations.createdAt }).from(conversations).orderBy(desc(conversations.createdAt)).limit(200);
    const msgCounts = await db.select({ conversationId: messages.conversationId, count: count() }).from(messages).groupBy(messages.conversationId);
    const countMap = Object.fromEntries(msgCounts.map(r => [r.conversationId, r.count]));
    res.json({ conversations: convs.map(c => ({ ...c, messageCount: countMap[c.id] || 0 })) });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/admin/conversations/:id", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const convId = parseInt(req.params.id);
  if (isNaN(convId)) return res.status(400).json({ error: "Invalid id" });
  await db.delete(messages).where(eq(messages.conversationId, convId));
  await db.delete(conversations).where(eq(conversations.id, convId));
  res.json({ success: true });
});

export default router;
