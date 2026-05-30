import { Router } from "express";
import { db, conversations as conversationsTable, messages as messagesTable } from "@workspace/db";
import { openrouter } from "@workspace/integrations-openrouter-ai";
import {
  CreateOpenrouterConversationBody,
  SendOpenrouterMessageBody,
  GetOpenrouterConversationParams,
  DeleteOpenrouterConversationParams,
  ListOpenrouterMessagesParams,
  SendOpenrouterMessageParams,
} from "@workspace/api-zod";
import { eq, desc } from "drizzle-orm";

const router = Router();

const MODELS: Record<string, string> = {
  "llama-3.3": "meta-llama/llama-3.3-70b-instruct",
  "llama-4-scout": "meta-llama/llama-4-scout",
  "mistral": "mistralai/mistral-small-2603",
  "gemma": "google/gemma-3n-e4b-it",
  "qwen": "qwen/qwen3.6-flash",
};

const DEFAULT_MODEL = "meta-llama/llama-3.3-70b-instruct";

router.get("/openrouter/conversations", async (req, res) => {
  try {
    const conversations = await db
      .select()
      .from(conversationsTable)
      .orderBy(desc(conversationsTable.createdAt));
    res.json(conversations);
  } catch (err) {
    res.status(500).json({ error: "Failed to list conversations" });
  }
});

router.post("/openrouter/conversations", async (req, res) => {
  const parsed = CreateOpenrouterConversationBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }
  try {
    const [conv] = await db
      .insert(conversationsTable)
      .values({ title: parsed.data.title })
      .returning();
    return res.status(201).json(conv);
  } catch (err) {
    return res.status(500).json({ error: "Failed to create conversation" });
  }
});

router.get("/openrouter/conversations/:id", async (req, res) => {
  const parsed = GetOpenrouterConversationParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid id" });
  }
  try {
    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, parsed.data.id));
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
  const parsed = DeleteOpenrouterConversationParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid id" });
  }
  try {
    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, parsed.data.id));
    if (!conv) return res.status(404).json({ error: "Conversation not found" });
    await db.delete(messagesTable).where(eq(messagesTable.conversationId, parsed.data.id));
    await db.delete(conversationsTable).where(eq(conversationsTable.id, parsed.data.id));
    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: "Failed to delete conversation" });
  }
});

router.delete("/openrouter/conversations/:id/messages/:messageId", async (req, res) => {
  const convId = Number(req.params.id);
  const msgId = Number(req.params.messageId);
  if (isNaN(convId) || isNaN(msgId)) {
    return res.status(400).json({ error: "Invalid id" });
  }
  try {
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
  const parsed = ListOpenrouterMessagesParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid id" });
  }
  try {
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
      .where(eq(conversationsTable.id, conversationId));
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
      // Try to parse structured content with attachments
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

    const messagesWithSystem = systemPrompt
      ? [{ role: "system" as const, content: systemPrompt }, ...chatMessages]
      : chatMessages;

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
