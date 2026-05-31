import { Router } from "express";
import { db, conversations as conversationsTable, messages as messagesTable } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { openrouter } from "@workspace/integrations-openrouter-ai";
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
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, payload.userId)).limit(1);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return { userId: user.id };
}

const MODELS: Record<string, string> = {
  "llama-3.3": "meta-llama/llama-3.3-70b-instruct",
  "llama-4-scout": "meta-llama/llama-4-scout",
  "mistral": "mistralai/mistral-small-2603",
  "gemma": "google/gemma-3n-e4b-it",
  "qwen": "qwen/qwen3.6-flash",
};

const DEFAULT_MODEL = "meta-llama/llama-3.3-70b-instruct";

const BASE_SYSTEM_PROMPT = `You are an AI coding assistant built into a full-featured AI chat application. Here is everything you need to know about the app and your role:

## What you are
You are a powerful AI assistant optimized for software development, code review, debugging, and general questions. You run inside a custom AI chat app that integrates directly with GitHub.

## App capabilities you can leverage
- **GitHub integration**: Users can connect any GitHub repository. When a repo is connected, you receive the README and full file tree as context — use this to give accurate, project-specific answers.
- **Code commits**: When you write code that should be saved to a file, start the code block's first line with \`// File: path/to/file\` (or \`# File: path/to/file\` for Python/shell). A "Commit to GitHub" button will automatically appear, letting the user push your code directly to their repo.
- **Multiple AI models**: The user can switch between Llama 3.3 70B, Llama 4 Scout (Vision), Mistral Small, Gemma 3, and Qwen 3.6 Flash.
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
- When a user asks what you can do or what this app does, explain the features above.`;

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
  const modelName = MODELS[modelKey] ?? DEFAULT_MODEL;
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

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let fullResponse = "";

    const fullSystemPrompt = systemPrompt
      ? `${BASE_SYSTEM_PROMPT}\n\n---\n\n## Connected Repository Context\n\n${systemPrompt}`
      : BASE_SYSTEM_PROMPT;

    const messagesWithSystem = [
      { role: "system" as const, content: fullSystemPrompt },
      ...chatMessages,
    ];

    const stream = await openrouter.chat.completions.create({
      model: modelName,
      max_tokens: 8192,
      messages: messagesWithSystem,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullResponse += content;
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    await db.insert(messagesTable).values({
      conversationId,
      role: "assistant",
      content: fullResponse,
    });

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      return res.status(500).json({ error: "Failed to send message" });
    }
    res.write(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`);
    res.end();
  }
});

export default router;
