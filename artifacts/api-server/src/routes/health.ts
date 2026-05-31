import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/health/providers", (_req, res) => {
  res.json({
    openrouter: !!(process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL && process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY),
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    github: !!process.env.GITHUB_TOKEN,
    copilot: !!process.env.GITHUB_TOKEN, // Copilot uses GITHUB_TOKEN (needs Copilot subscription)
    ollama: true,
  });
});

export default router;
