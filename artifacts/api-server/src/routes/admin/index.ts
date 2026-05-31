import { Router } from "express";
import { db } from "@workspace/db";
import { users, apiKeys } from "@workspace/db/schema";
import { conversations, messages } from "@workspace/db/schema";
import { eq, desc, count } from "drizzle-orm";
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
    const [adminCount] = await db.select({ count: count() }).from(users).where(eq(users.isAdmin, true));
    const convTotal = Number(convCount.count) || 1;
    const msgTotal = Number(msgCount.count);
    const avgMsgsPerConv = convTotal > 0 ? (msgTotal / convTotal).toFixed(1) : "0";
    return res.json({ users: userCount.count, conversations: convCount.count, messages: msgCount.count, apiKeys: keyCount.count, admins: adminCount.count, avgMsgsPerConv, planBreakdown });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/admin/users", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  try {
    const sort = (req.query.sort as string) || "newest";
    const search = (req.query.search as string || "").toLowerCase();
    const plan = req.query.plan as string;
    const allUsers = await db.select({ id: users.id, name: users.name, email: users.email, plan: users.plan, isAdmin: users.isAdmin, createdAt: users.createdAt }).from(users).orderBy(desc(users.createdAt));
    let filtered = allUsers;
    if (search) filtered = filtered.filter(u => u.name.toLowerCase().includes(search) || u.email.toLowerCase().includes(search));
    if (plan && plan !== "all") filtered = filtered.filter(u => u.plan === plan);
    if (sort === "oldest") filtered = filtered.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    else if (sort === "name") filtered = filtered.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "plan") filtered = filtered.sort((a, b) => a.plan.localeCompare(b.plan));
    return res.json({ users: filtered, total: allUsers.length });
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/admin/users/:id", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const userId = parseInt(req.params.id);
  if (isNaN(userId)) return res.status(400).json({ error: "Invalid id" });
  try {
    const [user] = await db.select({ id: users.id, name: users.name, email: users.email, plan: users.plan, isAdmin: users.isAdmin, createdAt: users.createdAt }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return res.status(404).json({ error: "User not found" });
    const [convCount] = await db.select({ count: count() }).from(conversations).where(eq(conversations.userId, userId));
    const [keyCount] = await db.select({ count: count() }).from(apiKeys).where(eq(apiKeys.userId, userId));
    const recentConvs = await db.select({ id: conversations.id, title: conversations.title, createdAt: conversations.createdAt }).from(conversations).where(eq(conversations.userId, userId)).orderBy(desc(conversations.createdAt)).limit(5);
    return res.json({ user, stats: { conversations: convCount.count, apiKeys: keyCount.count }, recentConversations: recentConvs });
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
});

router.patch("/admin/users/:id/plan", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const userId = parseInt(req.params.id);
  if (isNaN(userId)) return res.status(400).json({ error: "Invalid id" });
  const { plan } = req.body || {};
  if (!["starter", "pro", "business"].includes(plan)) return res.status(400).json({ error: "Invalid plan" });
  try {
    const [updated] = await db.update(users).set({ plan }).where(eq(users.id, userId)).returning({ id: users.id, plan: users.plan });
    return res.json({ user: updated });
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
});

router.patch("/admin/users/:id/admin", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const userId = parseInt(req.params.id);
  if (isNaN(userId)) return res.status(400).json({ error: "Invalid id" });
  if (userId === admin.userId) return res.status(400).json({ error: "Cannot change your own admin status" });
  const { isAdmin } = req.body || {};
  if (typeof isAdmin !== "boolean") return res.status(400).json({ error: "isAdmin must be a boolean" });
  try {
    const [updated] = await db.update(users).set({ isAdmin }).where(eq(users.id, userId)).returning({ id: users.id, isAdmin: users.isAdmin });
    return res.json({ user: updated });
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/admin/users/:id", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const userId = parseInt(req.params.id);
  if (isNaN(userId)) return res.status(400).json({ error: "Invalid id" });
  if (userId === admin.userId) return res.status(400).json({ error: "Cannot delete your own account" });
  try {
    await db.delete(apiKeys).where(eq(apiKeys.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/admin/users/bulk-delete", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required" });
  const filtered = ids.filter((id: unknown) => typeof id === "number" && id !== admin.userId);
  try {
    for (const id of filtered) {
      await db.delete(apiKeys).where(eq(apiKeys.userId, id));
      await db.delete(users).where(eq(users.id, id));
    }
    return res.json({ deleted: filtered.length });
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/admin/users/bulk-plan", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { ids, plan } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required" });
  if (!["starter", "pro", "business"].includes(plan)) return res.status(400).json({ error: "Invalid plan" });
  try {
    for (const id of ids) {
      if (typeof id !== "number") continue;
      await db.update(users).set({ plan }).where(eq(users.id, id));
    }
    return res.json({ updated: ids.length });
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/admin/conversations", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  try {
    const search = (req.query.search as string || "").toLowerCase();
    const convs = await db.select({ id: conversations.id, title: conversations.title, createdAt: conversations.createdAt }).from(conversations).orderBy(desc(conversations.createdAt)).limit(500);
    const msgCounts = await db.select({ conversationId: messages.conversationId, count: count() }).from(messages).groupBy(messages.conversationId);
    const countMap = Object.fromEntries(msgCounts.map(r => [r.conversationId, r.count]));
    let result = convs.map(c => ({ ...c, messageCount: Number(countMap[c.id]) || 0 }));
    if (search) result = result.filter(c => c.title.toLowerCase().includes(search));
    return res.json({ conversations: result });
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/admin/conversations/:id", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const convId = parseInt(req.params.id);
  if (isNaN(convId)) return res.status(400).json({ error: "Invalid id" });
  try {
    await db.delete(messages).where(eq(messages.conversationId, convId));
    await db.delete(conversations).where(eq(conversations.id, convId));
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/admin/conversations", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required" });
  try {
    for (const id of ids) {
      if (typeof id !== "number") continue;
      await db.delete(messages).where(eq(messages.conversationId, id));
      await db.delete(conversations).where(eq(conversations.id, id));
    }
    return res.json({ deleted: ids.length });
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/admin/activity", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  try {
    const recentUsers = await db.select({ id: users.id, name: users.name, email: users.email, plan: users.plan, createdAt: users.createdAt }).from(users).orderBy(desc(users.createdAt)).limit(10);
    const recentConvs = await db.select({ id: conversations.id, title: conversations.title, createdAt: conversations.createdAt }).from(conversations).orderBy(desc(conversations.createdAt)).limit(10);
    const events = [
      ...recentUsers.map(u => ({ type: "signup" as const, label: `${u.name} signed up`, sub: u.email, plan: u.plan, time: u.createdAt })),
      ...recentConvs.map(c => ({ type: "conversation" as const, label: c.title, sub: "New conversation", time: c.createdAt })),
    ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 20);
    return res.json({ events });
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
