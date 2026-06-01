import { Router } from "express";
import { spawn } from "child_process";
import { resolve } from "path";
import { existsSync, statSync } from "fs";
import { verifyToken } from "../auth";
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

async function requireAuth(req: any, res: any): Promise<{ userId: number } | null> {
  const payload = await verifyToken(req.headers.authorization);
  if (!payload) { res.status(401).json({ error: "Unauthorized" }); return null; }
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, payload.userId)).limit(1);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return null; }
  return { userId: user.id };
}

// Per-user working directory
const userCwd = new Map<number, string>();

function getCwd(userId: number): string {
  return userCwd.get(userId) || process.cwd();
}

// GET /api/terminal/cwd
router.get("/terminal/cwd", async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  res.json({ cwd: getCwd(auth.userId) });
});

// POST /api/terminal/exec — streams command output via SSE
router.post("/terminal/exec", async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const { command } = req.body || {};
  if (!command || typeof command !== "string") {
    res.status(400).json({ error: "command required" });
    return;
  }

  const cwd = getCwd(auth.userId);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (obj: object) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  // Handle `cd` separately (needs to persist CWD server-side)
  const trimmed = command.trim();
  if (/^cd(\s|$)/.test(trimmed)) {
    const target = trimmed.slice(2).trim() || (process.env.HOME ?? "/");
    const expanded = target.startsWith("~")
      ? (process.env.HOME ?? "/") + target.slice(1)
      : target;
    const newCwd = resolve(cwd, expanded);
    if (existsSync(newCwd) && statSync(newCwd).isDirectory()) {
      userCwd.set(auth.userId, newCwd);
      send({ type: "cwd", cwd: newCwd });
    } else {
      send({ type: "stderr", text: `cd: ${target}: No such file or directory\r\n` });
    }
    send({ type: "done", exitCode: 0, cwd: getCwd(auth.userId) });
    res.end();
    return;
  }

  // Handle `clear`
  if (trimmed === "clear" || trimmed === "cls") {
    send({ type: "clear" });
    send({ type: "done", exitCode: 0, cwd: cwd });
    res.end();
    return;
  }

  const child = spawn("bash", ["-c", command], {
    cwd,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      FORCE_COLOR: "3",
      COLORTERM: "truecolor",
      COLUMNS: "120",
      LINES: "40",
    },
  });

  let killed = false;

  child.stdout.on("data", (chunk: Buffer) => {
    send({ type: "stdout", text: chunk.toString() });
  });

  child.stderr.on("data", (chunk: Buffer) => {
    send({ type: "stderr", text: chunk.toString() });
  });

  child.on("close", (exitCode: number | null) => {
    if (!killed) {
      send({ type: "done", exitCode: exitCode ?? 0, cwd: getCwd(auth.userId) });
      res.end();
    }
  });

  child.on("error", (err: Error) => {
    send({ type: "stderr", text: `${err.message}\r\n` });
    send({ type: "done", exitCode: 1, cwd: getCwd(auth.userId) });
    res.end();
  });

  // Kill child if client disconnects
  req.on("close", () => {
    killed = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 1000);
  });

  // POST /api/terminal/kill — kill running process (via signal)
});

// POST /api/terminal/cwd — manually set CWD
router.post("/terminal/cwd", async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const { cwd } = req.body || {};
  if (!cwd || typeof cwd !== "string") { res.status(400).json({ error: "cwd required" }); return; }
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) { res.status(400).json({ error: "Not a directory" }); return; }
  userCwd.set(auth.userId, cwd);
  res.json({ cwd });
});

export default router;
