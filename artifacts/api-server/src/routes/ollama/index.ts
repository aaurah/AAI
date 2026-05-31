import { Router } from "express";

const router = Router();

const OLLAMA_URL = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/$/, "");

router.get("/ollama/models", async (_req, res) => {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!response.ok) {
      return res.status(502).json({ error: "Ollama server unavailable" });
    }
    const data = (await response.json()) as { models?: { name: string; size: number; modified_at: string }[] };
    const models = (data.models ?? []).map((m) => ({
      id: `ollama:${m.name}`,
      name: m.name,
      size: m.size,
    }));
    return res.json(models);
  } catch {
    return res.status(500).json({ error: "Could not reach Ollama" });
  }
});

export default router;
