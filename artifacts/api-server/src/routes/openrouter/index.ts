import { Router } from "express";
import { db, conversations as conversationsTable, messages as messagesTable } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { openrouter } from "@workspace/integrations-openrouter-ai";
import { ai as geminiAI } from "@workspace/integrations-gemini-ai";
import {
  CreateOpenrouterConversationBody,
  SendOpenrouterMessageBody,
  GetOpenrouterConversationParams,
  DeleteOpenrouterConversationParams,
  ListOpenrouterMessagesParams,
  SendOpenrouterMessageParams,
} from "@workspace/api-zod";
import { eq, desc, and } from "drizzle-orm";
import { verifyToken } from "../auth";

const router = Router();

// In-memory cache for Copilot tokens (keyed by GitHub token, value = {token, expiresAt ms})
const copilotTokenCache = new Map<string, { token: string; expiresAt: number }>();

// Per-user rate limit: max 20 AI messages per minute
const msgRateLimit = new Map<number, { count: number; resetAt: number }>();
function checkMsgRateLimit(userId: number): boolean {
  const now = Date.now();
  const record = msgRateLimit.get(userId);
  if (!record || record.resetAt < now) {
    msgRateLimit.set(userId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (record.count >= 20) return false;
  record.count++;
  return true;
}

async function requireAuth(req: any, res: any): Promise<{ userId: number } | null> {
  const payload = await verifyToken(req.headers.authorization);
  if (!payload) {
    res.status(401).json({ error: "Unauthorized — please sign in" });
    return null;
  }
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, payload.userId)).limit(1);
  if (!user) {
    res.status(401).json({ error: "Unauthorized — user not found" });
    return null;
  }
  return { userId: user.id };
}

// ── Model status cache ──────────────────────────────────────────────────────
type ModelStatus = "ok" | "blocked" | "rate_limited";
interface StatusEntry { status: ModelStatus; updatedAt: number }
const modelStatusCache = new Map<string, StatusEntry>();
const STATUS_TTL: Record<ModelStatus, number> = {
  ok: 10 * 60_000,         // 10 min — working models stay green
  blocked: 30 * 60_000,    // 30 min — guardrail blocks are semi-permanent
  rate_limited: 2 * 60_000, // 2 min  — rate limits are transient
};

function setModelStatus(key: string, status: ModelStatus) {
  modelStatusCache.set(key, { status, updatedAt: Date.now() });
}

function getModelStatuses(): Record<string, ModelStatus> {
  const now = Date.now();
  const result: Record<string, ModelStatus> = {};
  for (const [key, entry] of modelStatusCache.entries()) {
    if (now - entry.updatedAt < STATUS_TTL[entry.status]) {
      result[key] = entry.status;
    }
  }
  return result;
}

// All free OpenRouter models verified 2026-06-01 (excludes uncensored models blocked by proxy)
const MODELS: Record<string, string> = {
  // Meta Llama
  "llama-3.3": "meta-llama/llama-3.3-70b-instruct:free",
  "llama-3.2": "meta-llama/llama-3.2-3b-instruct:free",
  // Google Gemma 4
  "gemma-4": "google/gemma-4-31b-it:free",
  // Qwen 3
  "qwen3-coder": "qwen/qwen3-coder:free",
  "qwen3": "qwen/qwen3-next-80b-a3b-instruct:free",
  // OpenAI OSS
  "gpt-oss": "openai/gpt-oss-120b:free",
  "gpt-oss-small": "openai/gpt-oss-20b:free",
  // Moonshot / Kimi
  "kimi-k2": "moonshotai/kimi-k2.6:free",
  // NVIDIA Nemotron
  "nemotron": "nvidia/nemotron-3-super-120b-a12b:free",
  "nemotron-nano": "nvidia/nemotron-3-nano-30b-a3b:free",
  "nemotron-omni": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "nemotron-vl": "nvidia/nemotron-nano-12b-v2-vl:free",
  "nemotron-9b": "nvidia/nemotron-nano-9b-v2:free",
  // Poolside Laguna
  "laguna-m": "poolside/laguna-m.1:free",
  "laguna-xs": "poolside/laguna-xs.2:free",
  // LiquidAI
  "lfm": "liquid/lfm-2.5-1.2b-instruct:free",
  "lfm-thinking": "liquid/lfm-2.5-1.2b-thinking:free",
  // Z.ai
  "glm": "z-ai/glm-4.5-air:free",
};

// Reverse map: full OpenRouter model ID → short frontend key
const MODEL_KEYS: Record<string, string> = Object.fromEntries(
  Object.entries(MODELS).map(([k, v]) => [v, k])
);

const DEFAULT_MODEL = "meta-llama/llama-3.3-70b-instruct:free";

// ── GET /openrouter/models/status — returns live status of all tracked models ──
router.get("/openrouter/models/status", (_req, res) => {
  res.json(getModelStatuses());
});

const BASE_SYSTEM_PROMPT = `You are an AI coding assistant built into a full-featured AI chat application. Here is everything you need to know about the app and your role:

## What you are
You are a powerful AI assistant optimized for software development, code review, debugging, and general questions. You run inside a custom AI chat app that integrates directly with GitHub.

## App capabilities you can leverage
- **GitHub integration**: Users can connect any GitHub repository. When a repo is connected, you receive the README and full file tree as context — use this to give accurate, project-specific answers.
- **Code commits**: When you write code that should be saved to a file, start the code block's first line with \`// File: path/to/file\` (or \`# File: path/to/file\` for Python/shell). A "Commit to GitHub" button will automatically appear, letting the user push your code directly to their repo.
- **Multiple AI models**: The user can switch between Llama 3.3 70B, Llama 4 Scout (Vision), Mistral 7B, Gemma 2 9B, QwQ-32B, Claude Sonnet, Claude Haiku (via Anthropic API), and GitHub-hosted models (GPT-4o, Llama, Phi, etc.). Local models via Ollama are also supported when pulled to the server.
- **Vision**: Image and video attachments are supported (Llama 4 Scout handles images best).
- **Voice**: Users can speak messages via voice input and hear responses via text-to-speech.
- **Message actions**: Every message has copy, like/dislike, share, and text-to-speech buttons.
- **Conversation history**: All chats are saved to a database and accessible from the sidebar.
- **API keys**: Pro/Business users can generate API keys to use this service in their own projects.

## How to behave
- Be concise and direct. Prefer working code over lengthy explanation.
- When writing code to be committed, ALWAYS use the \`// File: path/to/filename\` marker on the first line of the code block so the commit button appears.
- If a GitHub repo is connected (you'll see repo context below), answer questions specifically about that codebase — reference actual files, functions, and patterns from the repo.
- If no repo is connected, give general best-practice advice.
- Format code in proper fenced code blocks with the correct language tag.
- When a user asks what you can do or what this app does, explain the features above.

## AI coding tools you can recommend
When users ask about AI coding assistant options, you can recommend:
- **GitHub Copilot** — IDE extension (VS Code, JetBrains, etc.) for inline code completions and chat. Requires a GitHub Copilot subscription.
- **Claude (claude.ai / Anthropic)** — Available directly in this chat app under the "Anthropic" model group. Also available as a VS Code extension via Cursor or claude.ai.
- **Cursor** — An AI-first IDE (fork of VS Code) with deep code understanding, multi-file edits, and chat. Uses Claude and GPT-4 under the hood. Download at cursor.sh.
- **Codeium** — Free AI code completion and chat for VS Code, JetBrains, and more. Download at codeium.com.
- **GitHub Models** — Azure-hosted models (GPT-4o, Llama, Phi, Mistral) accessible with a GitHub token — available in this app under the "GitHub Models" group.`;


router.get("/openrouter/conversations", async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  try {
    const conversations = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.userId, auth.userId))
      .orderBy(desc(conversationsTable.createdAt));
    res.json(conversations);
  } catch (err) {
    console.error("[GET /conversations]", err);
    res.status(500).json({ error: "Failed to list conversations" });
  }
});

router.post("/openrouter/conversations", async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const parsed = CreateOpenrouterConversationBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }
  try {
    const [conv] = await db
      .insert(conversationsTable)
      .values({ title: parsed.data.title, userId: auth.userId })
      .returning();
    return res.status(201).json(conv);
  } catch (err) {
    console.error("[POST /conversations]", err);
    return res.status(500).json({ error: "Failed to create conversation" });
  }
});

router.get("/openrouter/conversations/:id", async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const parsed = GetOpenrouterConversationParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid id" });
  }
  try {
    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(and(eq(conversationsTable.id, parsed.data.id), eq(conversationsTable.userId, auth.userId)));
    if (!conv) return res.status(404).json({ error: "Conversation not found" });
    const messages = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, parsed.data.id))
      .orderBy(messagesTable.createdAt);
    return res.json({ ...conv, messages });
  } catch (err) {
    return res.status(500).json({ error: "Failed to get conversation" });
  }
});

router.delete("/openrouter/conversations/:id", async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const parsed = DeleteOpenrouterConversationParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid id" });
  }
  try {
    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(and(eq(conversationsTable.id, parsed.data.id), eq(conversationsTable.userId, auth.userId)));
    if (!conv) return res.status(404).json({ error: "Conversation not found" });
    await db.delete(messagesTable).where(eq(messagesTable.conversationId, parsed.data.id));
    await db.delete(conversationsTable).where(eq(conversationsTable.id, parsed.data.id));
    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: "Failed to delete conversation" });
  }
});

router.delete("/openrouter/conversations/:id/messages/:messageId", async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const convId = Number(req.params.id);
  const msgId = Number(req.params.messageId);
  if (isNaN(convId) || isNaN(msgId)) {
    return res.status(400).json({ error: "Invalid id" });
  }
  try {
    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(and(eq(conversationsTable.id, convId), eq(conversationsTable.userId, auth.userId)));
    if (!conv) return res.status(404).json({ error: "Conversation not found" });
    const [msg] = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.id, msgId));
    if (!msg || msg.conversationId !== convId) {
      return res.status(404).json({ error: "Message not found" });
    }
    await db.delete(messagesTable).where(eq(messagesTable.id, msgId));
    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: "Failed to delete message" });
  }
});

router.get("/openrouter/conversations/:id/messages", async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const parsed = ListOpenrouterMessagesParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid id" });
  }
  try {
    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(and(eq(conversationsTable.id, parsed.data.id), eq(conversationsTable.userId, auth.userId)));
    if (!conv) return res.status(404).json({ error: "Conversation not found" });
    const messages = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, parsed.data.id))
      .orderBy(messagesTable.createdAt);
    return res.json(messages);
  } catch (err) {
    return res.status(500).json({ error: "Failed to list messages" });
  }
});

router.post("/openrouter/conversations/:id/messages", async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  if (!checkMsgRateLimit(auth.userId)) {
    return res.status(429).json({ error: "Too many messages. Wait a moment before sending again." });
  }
  const paramsParsed = SendOpenrouterMessageParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) {
    return res.status(400).json({ error: "Invalid id" });
  }
  const bodyParsed = SendOpenrouterMessageBody.safeParse(req.body);
  if (!bodyParsed.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const conversationId = paramsParsed.data.id;
  const userContent = bodyParsed.data.content;
  const modelKey = (req.query.model as string) || "llama-3.3";
  const isOllama = modelKey.startsWith("ollama:");
  const isAnthropic = modelKey.startsWith("claude:");
  const isGitHub = modelKey.startsWith("github:");
  const isCopilot = modelKey.startsWith("copilot:");
  const isGemini = modelKey.startsWith("gemini:");
  const modelName = isOllama
    ? modelKey.slice("ollama:".length)
    : isAnthropic
      ? modelKey.slice("claude:".length)
      : isGitHub
        ? modelKey.slice("github:".length)
        : isCopilot
          ? modelKey.slice("copilot:".length)
          : isGemini
            ? modelKey.slice("gemini:".length)
            : (MODELS[modelKey] ?? DEFAULT_MODEL);
  const systemPrompt = (req.body as any).systemPrompt as string | undefined;

  try {
    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(and(eq(conversationsTable.id, conversationId), eq(conversationsTable.userId, auth.userId)));
    if (!conv) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    await db.insert(messagesTable).values({
      conversationId,
      role: "user",
      content: userContent,
    });

    const history = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, conversationId))
      .orderBy(messagesTable.createdAt);

    const chatMessages = history.map((m) => {
      let parsed: { text?: string; attachments?: { type: string; data: string }[] } | null = null;
      try {
        const p = JSON.parse(m.content);
        if (p && Array.isArray(p.attachments)) parsed = p;
      } catch {}

      if (parsed && parsed.attachments && parsed.attachments.length > 0) {
        const contentParts: any[] = [];
        if (parsed.text) {
          contentParts.push({ type: "text", text: parsed.text });
        }
        for (const att of parsed.attachments) {
          if (att.type === "image") {
            contentParts.push({ type: "image_url", image_url: { url: att.data } });
          }
        }
        return { role: m.role as "user" | "assistant" | "system", content: contentParts };
      }

      return { role: m.role as "user" | "assistant" | "system", content: m.content };
    });

    const fullSystemPrompt = systemPrompt
      ? `${BASE_SYSTEM_PROMPT}\n\n---\n\n## Connected Repository Context\n\n${systemPrompt}`
      : BASE_SYSTEM_PROMPT;

    const messagesWithSystem = [
      { role: "system" as const, content: fullSystemPrompt },
      ...chatMessages,
    ];

    // ── Ollama (local) branch ──
    if (isOllama) {
      const ollamaUrl = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/$/, "");
      const ollamaResponse = await fetch(`${ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelName,
          messages: messagesWithSystem.map((m: { role: string; content: string | unknown[] }) => ({
            role: m.role,
            content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          })),
          stream: true,
        }),
      });

      if (!ollamaResponse.ok) {
        const raw = await ollamaResponse.text().catch(() => "");
        console.error(`[ollama] model=${modelName} HTTP ${ollamaResponse.status}: ${raw}`);
        return res.status(502).json({ error: `Ollama ${ollamaResponse.status}: ${raw.slice(0, 300)}` });
      }

      if (!ollamaResponse.body) {
        return res.status(502).json({ error: "Ollama returned an empty response body" });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const reader = (ollamaResponse.body as any).getReader();
      const decoder = new TextDecoder();
      let fullResponse = "";
      let buf = "";

      try {
        while (true) {
          const { done, value } = await reader.read() as { done: boolean; value?: Uint8Array };
          if (done) break;
          if (!value) continue;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const chunk = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
              const c = chunk.message?.content;
              if (c) {
                fullResponse += c;
                res.write(`data: ${JSON.stringify({ content: c })}\n\n`);
              }
            } catch {
              // skip malformed line
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      try { await db.insert(messagesTable).values({ conversationId, role: "assistant", content: fullResponse }); } catch {}
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
      return;
    }

    // ── Anthropic (Claude) branch ──
    if (isAnthropic) {
      const anthropicKey = process.env.ANTHROPIC_API_KEY ?? "";
      if (!anthropicKey) {
        return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured." });
      }

      const anthropicMessages = chatMessages.map((m: { role: string; content: string | unknown[] }) => ({
        role: m.role === "system" ? "user" : m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      }));

      const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: modelName,
          max_tokens: 4096,
          stream: true,
          system: fullSystemPrompt,
          messages: anthropicMessages,
        }),
      });

      if (!anthropicResponse.ok) {
        const raw = await anthropicResponse.text().catch(() => "");
        console.error(`[anthropic] model=${modelName} HTTP ${anthropicResponse.status}: ${raw}`);
        let hint = "";
        if (anthropicResponse.status === 400 && raw.includes("credit")) {
          hint = " Your Anthropic credit balance is too low — top up at console.anthropic.com/settings/billing, or switch to a free OpenRouter or GitHub model.";
        }
        const errMsg = `⚠️ Anthropic error (${anthropicResponse.status}).${hint}`;
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.write(`data: ${JSON.stringify({ content: errMsg })}\n\n`);
        await db.insert(messagesTable).values({ conversationId, role: "assistant", content: errMsg }).catch(() => {});
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
        return;
      }

      if (!anthropicResponse.body) {
        return res.status(502).json({ error: "Anthropic returned an empty response body" });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const reader = (anthropicResponse.body as any).getReader();
      const decoder = new TextDecoder();
      let fullResponse = "";
      let buf = "";

      try {
        while (true) {
          const { done, value } = await reader.read() as { done: boolean; value?: Uint8Array };
          if (done) break;
          if (!value) continue;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const d = line.slice(6).trim();
            if (!d || d === "[DONE]") continue;
            try {
              const chunk = JSON.parse(d) as { type?: string; delta?: { type?: string; text?: string } };
              if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta") {
                const c = chunk.delta.text ?? "";
                if (c) {
                  fullResponse += c;
                  res.write(`data: ${JSON.stringify({ content: c })}\n\n`);
                }
              }
            } catch {
              // skip malformed SSE line
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      try { await db.insert(messagesTable).values({ conversationId, role: "assistant", content: fullResponse }); } catch {}
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
      return;
    }

    // ── GitHub Models branch (OpenAI-compatible) ──
    if (isGitHub) {
      const ghToken = process.env.GITHUB_TOKEN ?? "";
      if (!ghToken) {
        return res.status(500).json({ error: "GITHUB_TOKEN is not configured." });
      }

      const ghResponse = await fetch("https://models.inference.ai.azure.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ghToken}`,
        },
        body: JSON.stringify({
          model: modelName,
          max_tokens: 4096,
          messages: messagesWithSystem,
          stream: true,
        }),
      });

      if (!ghResponse.ok) {
        const raw = await ghResponse.text().catch(() => "");
        console.error(`[github-models] model=${modelName} HTTP ${ghResponse.status}: ${raw}`);
        return res.status(502).json({ error: `GitHub Models ${ghResponse.status}: ${raw.slice(0, 300)}` });
      }

      if (!ghResponse.body) {
        return res.status(502).json({ error: "GitHub Models returned an empty response body" });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const reader = (ghResponse.body as any).getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let fullResponse = "";

      try {
        while (true) {
          const { done, value } = await reader.read() as { done: boolean; value?: Uint8Array };
          if (done) break;
          if (!value) continue;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const d = line.slice(6).trim();
            if (!d || d === "[DONE]") continue;
            try {
              const chunk = JSON.parse(d) as { choices?: { delta?: { content?: string } }[] };
              const c = chunk.choices?.[0]?.delta?.content;
              if (c) {
                fullResponse += c;
                res.write(`data: ${JSON.stringify({ content: c })}\n\n`);
              }
            } catch {
              // skip malformed SSE line
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      try { await db.insert(messagesTable).values({ conversationId, role: "assistant", content: fullResponse }); } catch {}
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
      return;
    }

    // ── GitHub Copilot branch ──
    if (isCopilot) {
      const ghToken = (req.headers["x-github-token"] as string) || (process.env.GITHUB_TOKEN ?? "");
      if (!ghToken) {
        return res.status(500).json({ error: "GitHub Copilot requires a GitHub token. Connect GitHub in Settings or set GITHUB_TOKEN in Replit Secrets." });
      }

      // Exchange GitHub token for a short-lived Copilot token (cached ~28 min)
      const cached = copilotTokenCache.get(ghToken);
      let copilotToken: string;
      if (cached && cached.expiresAt > Date.now() + 60_000) {
        copilotToken = cached.token;
      } else {
        const tokenRes = await fetch("https://api.github.com/copilot_internal/v2/token", {
          headers: {
            Authorization: `Bearer ${ghToken}`,
            "User-Agent": "AAI-Chat/1.0",
          },
        });
        if (!tokenRes.ok) {
          const raw = await tokenRes.text().catch(() => "");
          return res.status(502).json({ error: `Copilot token exchange failed (${tokenRes.status}). Make sure you have a GitHub Copilot subscription. ${raw.slice(0, 200)}` });
        }
        const tokenData = (await tokenRes.json()) as { token: string; expires_at: number };
        copilotToken = tokenData.token;
        copilotTokenCache.set(ghToken, { token: copilotToken, expiresAt: tokenData.expires_at * 1000 });
      }

      const copilotResponse = await fetch("https://api.githubcopilot.com/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${copilotToken}`,
          "Content-Type": "application/json",
          "Editor-Version": "vscode/1.95.0",
          "Editor-Plugin-Version": "copilot-chat/0.22.0",
          "Copilot-Integration-Id": "vscode-chat",
        },
        body: JSON.stringify({
          model: modelName,
          max_tokens: 4096,
          messages: messagesWithSystem,
          stream: true,
        }),
      });

      if (!copilotResponse.ok) {
        const raw = await copilotResponse.text().catch(() => "");
        console.error(`[copilot] model=${modelName} HTTP ${copilotResponse.status}: ${raw}`);
        return res.status(502).json({ error: `Copilot ${copilotResponse.status}: ${raw.slice(0, 300)}` });
      }

      if (!copilotResponse.body) {
        return res.status(502).json({ error: "Copilot returned an empty response body" });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const reader = (copilotResponse.body as any).getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let fullResponse = "";

      try {
        while (true) {
          const { done, value } = await reader.read() as { done: boolean; value?: Uint8Array };
          if (done) break;
          if (!value) continue;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const d = line.slice(6).trim();
            if (!d || d === "[DONE]") continue;
            try {
              const chunk = JSON.parse(d) as { choices?: { delta?: { content?: string } }[] };
              const c = chunk.choices?.[0]?.delta?.content;
              if (c) {
                fullResponse += c;
                res.write(`data: ${JSON.stringify({ content: c })}\n\n`);
              }
            } catch {
              // skip malformed SSE line
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      try { await db.insert(messagesTable).values({ conversationId, role: "assistant", content: fullResponse }); } catch {}
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
      return;
    }

    // ── Gemini branch (via Replit AI Integrations proxy — no API key needed) ──
    if (isGemini) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      // Build Gemini-format message list (system as first user turn, "assistant" → "model")
      const geminiContents = messagesWithSystem
        .filter((m: any) => m.role !== "system")
        .map((m: any) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: Array.isArray(m.content)
            ? m.content.map((p: any) =>
                p.type === "image_url"
                  ? { inlineData: { mimeType: "image/jpeg", data: p.image_url.url.replace(/^data:[^;]+;base64,/, "") } }
                  : { text: p.text ?? "" }
              )
            : [{ text: typeof m.content === "string" ? m.content : "" }],
        }));

      // Prepend system as first user message if present
      const systemMsg = messagesWithSystem.find((m: any) => m.role === "system");
      if (systemMsg) {
        geminiContents.unshift({ role: "user", parts: [{ text: systemMsg.content as string }] });
        geminiContents.splice(1, 0, { role: "model", parts: [{ text: "Understood." }] });
      }

      let fullResponse = "";
      const geminiStatusKey = `gemini:${modelName}`;
      try {
        const stream = await geminiAI.models.generateContentStream({
          model: modelName,
          contents: geminiContents,
          config: { maxOutputTokens: 8192 },
        });
        for await (const chunk of stream) {
          const text = chunk.text;
          if (text) {
            fullResponse += text;
            res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
          }
        }
        setModelStatus(geminiStatusKey, "ok");
      } catch (err: any) {
        setModelStatus(geminiStatusKey, "blocked");
        const msg = `⚠️ Gemini error: ${err?.message ?? String(err)}`;
        res.write(`data: ${JSON.stringify({ content: msg })}\n\n`);
        await db.insert(messagesTable).values({ conversationId, role: "assistant", content: msg }).catch(() => {});
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
        return;
      }

      await db.insert(messagesTable).values({ conversationId, role: "assistant", content: fullResponse }).catch(() => {});
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
      return;
    }

    // ── OpenRouter branch (via Replit AI Integrations proxy — no API key needed) ──
    // Fallback chain — all verified free models, proxy-safe (no uncensored)
    const OR_FALLBACK_MODELS = [
      "meta-llama/llama-3.3-70b-instruct:free",
      "google/gemma-4-31b-it:free",
      "qwen/qwen3-coder:free",
      "openai/gpt-oss-120b:free",
      "moonshotai/kimi-k2.6:free",
      "nvidia/nemotron-3-super-120b-a12b:free",
      "qwen/qwen3-next-80b-a3b-instruct:free",
      "openai/gpt-oss-20b:free",
      "meta-llama/llama-3.2-3b-instruct:free",
    ];

    const modelsToTry = [modelName, ...OR_FALLBACK_MODELS.filter((m) => m !== modelName)].slice(0, 6);

    // Helper: stream an error as an inline assistant message
    const streamInlineError = async (msg: string) => {
      if (!res.headersSent) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
      }
      res.write(`data: ${JSON.stringify({ content: msg })}\n\n`);
      await db.insert(messagesTable).values({ conversationId, role: "assistant", content: msg }).catch(() => {});
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    };

    let stream: AsyncIterable<any> | null = null;
    let usedModel = modelName;

    for (const tryModel of modelsToTry) {
      try {
        const attempt = await openrouter.chat.completions.create({
          model: tryModel,
          max_tokens: 8192,
          messages: messagesWithSystem as any,
          stream: true,
        });
        stream = attempt;
        usedModel = tryModel;
        setModelStatus(MODEL_KEYS[tryModel] ?? tryModel, "ok");
        break;
      } catch (err: any) {
        const status = err?.status ?? err?.statusCode ?? 0;
        const errMsg = err?.message ?? String(err);
        const isGuardrail = status === 404 && errMsg.toLowerCase().includes("guardrail");
        if (status === 429 || isGuardrail) {
          const reason = isGuardrail ? "blocked by proxy guardrails" : "rate-limited (429)";
          setModelStatus(MODEL_KEYS[tryModel] ?? tryModel, isGuardrail ? "blocked" : "rate_limited");
          console.warn(`[openrouter] ${tryModel} ${reason}, trying fallback...`);
          continue;
        }
        console.error(`[openrouter] model=${tryModel} error:`, err?.message ?? err);
        await streamInlineError(`⚠️ OpenRouter error: ${err?.message ?? String(err)}`);
        return;
      }
    }

    if (!stream) {
      // All OpenRouter models rate-limited → auto-fallback to Gemini Flash (separate API, no shared rate limit)
      console.info("[openrouter] all OR models exhausted — auto-falling back to Gemini Flash");
      const fallbackGeminiModel = "gemini-2.5-flash-preview-05-20";
      const fallbackGeminiKey = `gemini:${fallbackGeminiModel}`;
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const fbContents = messagesWithSystem
        .filter((m: any) => m.role !== "system")
        .map((m: any) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: Array.isArray(m.content)
            ? m.content.map((p: any) =>
                p.type === "image_url"
                  ? { inlineData: { mimeType: "image/jpeg", data: p.image_url.url.replace(/^data:[^;]+;base64,/, "") } }
                  : { text: p.text ?? "" }
              )
            : [{ text: typeof m.content === "string" ? m.content : "" }],
        }));
      const fbSystem = messagesWithSystem.find((m: any) => m.role === "system");
      if (fbSystem) {
        fbContents.unshift({ role: "user", parts: [{ text: fbSystem.content as string }] });
        fbContents.splice(1, 0, { role: "model", parts: [{ text: "Understood." }] });
      }

      try {
        res.write(`data: ${JSON.stringify({ content: "*[Auto-switched to Gemini Flash — OpenRouter rate limited]*\n\n" })}\n\n`);
        const fbStream = await geminiAI.models.generateContentStream({
          model: fallbackGeminiModel,
          contents: fbContents,
          config: { maxOutputTokens: 8192 },
        });
        let fbFull = "*[Auto-switched to Gemini Flash — OpenRouter rate limited]*\n\n";
        for await (const chunk of fbStream) {
          const text = chunk.text;
          if (text) {
            fbFull += text;
            res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
          }
        }
        setModelStatus(fallbackGeminiKey, "ok");
        await db.insert(messagesTable).values({ conversationId, role: "assistant", content: fbFull }).catch(() => {});
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      } catch (fbErr: any) {
        setModelStatus(fallbackGeminiKey, "blocked");
        await streamInlineError(
          "⚠️ All free OpenRouter models are rate-limited and Gemini fallback also failed. Please try again in a moment, or switch to **Gemini Flash** or a **GitHub model** using the model selector."
        );
      }
      return;
    }

    if (usedModel !== modelName) {
      console.info(`[openrouter] fell back from ${modelName} to ${usedModel}`);
    }

    // ── Stream response to client ──
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let fullResponse = "";

    for await (const chunk of stream) {
      const c = chunk.choices?.[0]?.delta?.content;
      if (c) {
        fullResponse += c;
        res.write(`data: ${JSON.stringify({ content: c })}\n\n`);
      }
    }

    await db.insert(messagesTable).values({ conversationId, role: "assistant", content: fullResponse });
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
    return;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[openrouter] error:`, err);
    if (!res.headersSent) {
      return res.status(500).json({ error: errMsg });
    }
    res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`);
    res.end();
    return;
  }
});

export default router;
