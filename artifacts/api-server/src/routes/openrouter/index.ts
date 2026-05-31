import { Router } from "express";
import { db, conversations as conversationsTable, messages as messagesTable } from "@workspace/db";
import { users } from "@workspace/db/schema";
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

// All models target the :free tier so no OpenRouter credits are needed.
const MODELS: Record<string, string> = {
  "llama-3.3": "meta-llama/llama-3.3-70b-instruct:free",
  "llama-4-scout": "meta-llama/llama-4-scout:free",
  "mistral": "mistralai/mistral-7b-instruct:free",
  "gemma": "google/gemma-2-9b-it:free",
  "qwen": "qwen/qwq-32b:free",
};

const DEFAULT_MODEL = "meta-llama/llama-3.3-70b-instruct:free";

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
  const modelName = isOllama
    ? modelKey.slice("ollama:".length)
    : isAnthropic
      ? modelKey.slice("claude:".length)
      : isGitHub
        ? modelKey.slice("github:".length)
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

      await db.insert(messagesTable).values({ conversationId, role: "assistant", content: fullResponse });
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
        return res.status(502).json({ error: `Anthropic ${anthropicResponse.status}: ${raw.slice(0, 300)}` });
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

      await db.insert(messagesTable).values({ conversationId, role: "assistant", content: fullResponse });
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

      await db.insert(messagesTable).values({ conversationId, role: "assistant", content: fullResponse });
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
      return;
    }

    // ── OpenRouter branch ──
    const orBaseUrl = (process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL ?? "").replace(/\/$/, "");
    const orApiKey = process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY ?? "";

    if (!orBaseUrl || !orApiKey) {
      return res.status(500).json({
        error: "OpenRouter is not configured. Set AI_INTEGRATIONS_OPENROUTER_BASE_URL and AI_INTEGRATIONS_OPENROUTER_API_KEY in Replit Secrets.",
      });
    }

    // ── Direct fetch to OpenRouter (bypasses SDK to expose raw HTTP status) ──
    const orResponse = await fetch(`${orBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${orApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://aai.app",
        "X-Title": "AAI Chat",
      },
      body: JSON.stringify({
        model: modelName,
        max_tokens: 4096,
        messages: messagesWithSystem,
        stream: true,
      }),
    });

    if (!orResponse.ok) {
      const rawBody = await orResponse.text().catch(() => "");
      let errMsg = `OpenRouter ${orResponse.status}`;
      try {
        const j = JSON.parse(rawBody) as any;
        const detail = j?.error?.message ?? j?.error ?? j?.message;
        if (detail) errMsg += `: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
        else if (rawBody) errMsg += `: ${rawBody.slice(0, 300)}`;
      } catch {
        if (rawBody) errMsg += `: ${rawBody.slice(0, 300)}`;
      }
      console.error(`[openrouter] model=${modelName} HTTP ${orResponse.status}: ${rawBody}`);
      return res.status(502).json({ error: errMsg });
    }

    if (!orResponse.body) {
      return res.status(502).json({ error: "OpenRouter returned an empty response body" });
    }

    // ── Stream response to client ──
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const reader = (orResponse.body as any).getReader();
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

    await db.insert(messagesTable).values({
      conversationId,
      role: "assistant",
      content: fullResponse,
    });

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[openrouter] model=${modelName} error:`, err);
    if (!res.headersSent) {
      return res.status(500).json({ error: errMsg });
    }
    res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`);
    res.end();
  }
});

export default router;
