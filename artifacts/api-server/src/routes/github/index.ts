import { Router } from "express";

const router = Router();

// Use server-configured client ID if available; otherwise accept from request body (for self-hosted deployments)
const SERVER_GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? "";

// List available GitHub Models
router.get("/github/models", async (_req, res) => {
  const token = process.env.GITHUB_TOKEN ?? "";
  if (!token) return res.status(400).json({ error: "GITHUB_TOKEN not configured" });
  try {
    const response = await fetch("https://models.inference.ai.azure.com/models", {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!response.ok) return res.status(response.status).json({ error: "Failed to fetch GitHub Models" });
    const data = await response.json() as any[];
    // Return only chat-capable models with id and display name
    const models = data
      .filter((m: any) => m.task === "chat-completion" || !m.task)
      .map((m: any) => ({ id: m.name ?? m.id, name: m.friendly_name ?? m.display_name ?? m.name ?? m.id }));
    return res.json(models);
  } catch {
    return res.status(500).json({ error: "Failed to fetch GitHub Models" });
  }
});

// Proxy GitHub API calls so the server token is never exposed to the browser
router.get("/github/repos/:owner/:repo/contents", async (req, res) => {
  const { owner, repo } = req.params;
  const path = (req.query.path as string) || "";
  const ref = (req.query.ref as string) || "HEAD";
  const token = req.headers["x-github-token"] as string | undefined || process.env.GITHUB_TOKEN || "";
  const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  try {
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`;
    const response = await fetch(url, { headers });
    const data = await response.json() as any;
    if (!response.ok) return res.status(response.status).json({ error: data.message || "GitHub error" });
    // Decode base64 content if it's a file
    if (data.encoding === "base64" && typeof data.content === "string") {
      data.text = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
    }
    return res.json(data);
  } catch {
    return res.status(500).json({ error: "Failed to fetch from GitHub" });
  }
});

router.get("/github/repos/:owner/:repo/search", async (req, res) => {
  const { owner, repo } = req.params;
  const q = (req.query.q as string) || "";
  if (!q) return res.status(400).json({ error: "q query param required" });
  const token = req.headers["x-github-token"] as string | undefined || process.env.GITHUB_TOKEN || "";
  if (!token) return res.status(400).json({ error: "GitHub token required for code search" });
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    Authorization: `Bearer ${token}`,
  };
  try {
    const encoded = encodeURIComponent(`${q} repo:${owner}/${repo}`);
    const response = await fetch(`https://api.github.com/search/code?q=${encoded}&per_page=10`, { headers });
    const data = await response.json() as any;
    if (!response.ok) return res.status(response.status).json({ error: data.message || "GitHub search error" });
    return res.json(data);
  } catch {
    return res.status(500).json({ error: "Failed to search GitHub" });
  }
});

router.post("/github/device/code", async (req, res) => {
  const clientId = SERVER_GITHUB_CLIENT_ID || req.body?.clientId;
  if (!clientId) return res.status(400).json({ error: "GitHub OAuth client ID is not configured. Set GITHUB_CLIENT_ID in Replit Secrets." });

  try {
    const response = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: clientId, scope: "repo read:user" }),
    });
    const data = await response.json() as Record<string, unknown>;
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: "Failed to contact GitHub" });
  }
});

router.post("/github/device/token", async (req, res) => {
  const clientId = SERVER_GITHUB_CLIENT_ID || req.body?.clientId;
  const { deviceCode } = req.body;
  if (!clientId || !deviceCode) return res.status(400).json({ error: "clientId and deviceCode required" });

  try {
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const data = await response.json() as Record<string, unknown>;
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: "Failed to contact GitHub" });
  }
});

export default router;
