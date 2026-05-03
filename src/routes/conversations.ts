import { Router, type Request, type Response } from "express";
import { z } from "zod";
import mongoose, { type Types } from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { Conversation, type IConversation } from "../models/Conversation.js";
import { Message, type IMessage } from "../models/Message.js";
import { streamReply, type HistoryMessage } from "../services/gemini.js";
import { generateAndPatchTitle } from "../services/title.js";
import { logger } from "../logger.js";
import { messagesRateLimit } from "../middleware/rateLimit.js";

type ConversationLean = IConversation & { _id: Types.ObjectId };
type MessageLean = IMessage & { _id: Types.ObjectId };

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});

const importSchema = z.object({
  items: z
    .array(
      z.object({
        prompt: z.string().trim().min(1).max(4096),
        response: z.string().trim().max(12288),
      }),
    )
    .min(1)
    .max(25),
});

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  archived: z.boolean().optional(),
});

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const messagesQuerySchema = z.object({
  before: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

function publicConversation(c: ConversationLean) {
  return {
    id: c._id.toString(),
    title: c.title,
    messageCount: c.messageCount,
    archived: c.archived,
    lastMessageAt: c.lastMessageAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function publicMessage(m: MessageLean) {
  return {
    id: m._id.toString(),
    conversationId: m.conversationId.toString(),
    role: m.role,
    content: m.content,
    truncated: m.truncated,
    createdAt: m.createdAt,
  };
}

async function findOwned(id: string, userId: string) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, "Conversation not found");
  const conv = await Conversation.findById(id);
  if (!conv) throw new HttpError(404, "Conversation not found");
  if (conv.userId.toString() !== userId) throw new HttpError(403, "Forbidden");
  return conv;
}

// GET /conversations?cursor=<updatedAt ISO>&limit=20
router.get("/", async (req: Request, res: Response) => {
  const { cursor, limit } = listQuerySchema.parse(req.query);

  const filter: Record<string, unknown> = { userId: req.userId, archived: false };
  if (cursor) {
    const cursorDate = new Date(cursor);
    if (isNaN(cursorDate.getTime())) throw new HttpError(400, "Invalid cursor");
    filter.updatedAt = { $lt: cursorDate };
  }

  const rows = await Conversation.find(filter)
    .sort({ updatedAt: -1 })
    .limit(limit + 1)
    .lean<ConversationLean[]>();

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? last.updatedAt.toISOString() : null;

  res.json({ conversations: items.map(publicConversation), nextCursor });
});

const MAX_CONVERSATIONS = 200;

// POST /conversations
router.post("/", async (req: Request, res: Response) => {
  const body = createSchema.parse(req.body);

  // Soft cap: auto-archive the oldest conversation when user hits the limit
  const activeCount = await Conversation.countDocuments({ userId: req.userId, archived: false });
  if (activeCount >= MAX_CONVERSATIONS) {
    const oldest = await Conversation.findOne({ userId: req.userId, archived: false })
      .sort({ updatedAt: 1 })
      .select("_id");
    if (oldest) {
      await Conversation.updateOne(
        { _id: oldest._id },
        { $set: { archived: true, archivedAt: new Date() } },
      );
    }
  }

  const conv = await Conversation.create({
    userId: req.userId,
    title: body.title ?? "New chat",
  });

  res.status(201).json({ conversation: publicConversation(conv.toObject() as ConversationLean) });
});

// POST /conversations/import  { items: [{ prompt, response }] }
// One-time bulk import of legacy localStorage conversations.
router.post("/import", async (req: Request, res: Response) => {
  const body = importSchema.parse(req.body);

  // Filter out pairs with no assistant response (aborted generations)
  const validItems = body.items.filter((item) => item.response.length > 0);
  if (validItems.length === 0) {
    throw new HttpError(400, "No valid items to import");
  }

  const firstPrompt = validItems[0]!.prompt;
  const title = firstPrompt.length > 50 ? firstPrompt.slice(0, 47) + "…" : firstPrompt;

  const conv = await Conversation.create({ userId: req.userId, title });

  const messageDocs = validItems.flatMap((item) => [
    { conversationId: conv._id, userId: req.userId, role: "user" as const, content: item.prompt },
    {
      conversationId: conv._id,
      userId: req.userId,
      role: "assistant" as const,
      content: item.response,
    },
  ]);

  await Message.insertMany(messageDocs);
  const messageCount = messageDocs.length;

  await Conversation.updateOne(
    { _id: conv._id },
    { $set: { messageCount, lastMessageAt: new Date() } },
  );

  const updated = await Conversation.findById(conv._id).lean<ConversationLean>();
  res.status(201).json({ conversation: publicConversation(updated!) });
});

type IdParams = { id: string };

// GET /conversations/:id
router.get("/:id", async (req: Request<IdParams>, res: Response) => {
  const conv = await findOwned(req.params.id, req.userId!);
  res.json({ conversation: publicConversation(conv.toObject() as ConversationLean) });
});

// PATCH /conversations/:id  { title?, archived? }
router.patch("/:id", async (req: Request<IdParams>, res: Response) => {
  const body = patchSchema.parse(req.body);
  if (body.title === undefined && body.archived === undefined) {
    throw new HttpError(400, "At least one of title or archived is required");
  }

  const conv = await findOwned(req.params.id, req.userId!);
  if (body.title !== undefined) conv.title = body.title;
  if (body.archived !== undefined) {
    conv.archived = body.archived;
    conv.archivedAt = body.archived ? new Date() : undefined;
  }
  await conv.save();

  res.json({ conversation: publicConversation(conv.toObject() as ConversationLean) });
});

// DELETE /conversations/:id
router.delete("/:id", async (req: Request<IdParams>, res: Response) => {
  const conv = await findOwned(req.params.id, req.userId!);
  await Promise.all([conv.deleteOne(), Message.deleteMany({ conversationId: conv._id })]);
  res.status(204).end();
});

// GET /conversations/:id/messages?before=<msgId>&limit=50
// Returns the most recent `limit` messages before the cursor, in chronological order.
// Omit `before` to get the latest batch.
router.get("/:id/messages", async (req: Request<IdParams>, res: Response) => {
  const { before, limit } = messagesQuerySchema.parse(req.query);
  const conv = await findOwned(req.params.id, req.userId!);

  const filter: Record<string, unknown> = { conversationId: conv._id };
  if (before) {
    if (!mongoose.isValidObjectId(before)) throw new HttpError(400, "Invalid cursor");
    filter._id = { $lt: new mongoose.Types.ObjectId(before) };
  }

  // Fetch newest-first so we get the right "page", then reverse to chronological.
  const rows = await Message.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean<MessageLean[]>();

  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).reverse();
  const first = items[0];
  const nextBefore = hasMore && first ? first._id.toString() : null;

  res.json({ messages: items.map(publicMessage), nextBefore });
});

const postMessageSchema = z.object({
  content: z.string().trim().min(1).max(4096),
});

const MAX_ASSISTANT_CHARS = 12_288; // 12 KB hard cap per system design

const MAX_MESSAGES_PER_CONVERSATION = 50;

// POST /conversations/:id/messages  { content }
// Streams the Gemini reply and persists both messages.
router.post("/:id/messages", messagesRateLimit, async (req: Request<IdParams>, res: Response) => {
  const body = postMessageSchema.parse(req.body);
  const conv = await findOwned(req.params.id, req.userId!);

  if (conv.messageCount >= MAX_MESSAGES_PER_CONVERSATION) {
    throw new HttpError(403, "Conversation is full. Start a new chat to continue.");
  }

  const isFirstExchange = conv.messageCount === 0;

  // Load prior turns for Gemini context (newest-first → reverse to chronological)
  const priorDocs = await Message.find({ conversationId: conv._id })
    .sort({ _id: -1 })
    .limit(20)
    .lean<MessageLean[]>();
  const history: HistoryMessage[] = priorDocs.reverse().map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Persist user message before streaming begins
  const userMsg = await Message.create({
    conversationId: conv._id,
    userId: req.userId,
    role: "user",
    content: body.content,
  });

  // Commit to a streaming response — errors after this point end silently
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");

  let buffer = "";
  let truncated = false;
  let clientGone = false;

  req.on("close", () => {
    if (!res.writableEnded) clientGone = true;
  });

  try {
    for await (const chunk of streamReply(body.content, history)) {
      if (clientGone) {
        truncated = true;
        break;
      }
      if (buffer.length + chunk.length >= MAX_ASSISTANT_CHARS) {
        const remaining = MAX_ASSISTANT_CHARS - buffer.length;
        const trimmed = chunk.slice(0, remaining);
        buffer += trimmed;
        res.write(trimmed);
        truncated = true;
        break;
      }
      buffer += chunk;
      res.write(chunk);
    }
  } catch (err) {
    truncated = true;
    logger.error({ err }, "Gemini stream error");
  }

  // Persist assistant reply (skip if nothing was generated)
  const assistantInserted = buffer.length > 0;
  if (assistantInserted) {
    await Message.create({
      conversationId: conv._id,
      userId: req.userId,
      role: "assistant",
      content: buffer,
      truncated,
    });
  }

  // Update conversation counters — timestamps plugin handles updatedAt
  await Conversation.updateOne(
    { _id: conv._id },
    {
      $inc: { messageCount: assistantInserted ? 2 : 1 },
      $set: { lastMessageAt: userMsg.createdAt },
    },
  );

  if (!res.writableEnded) res.end();

  // Async title generation — fires after response is sent; errors are swallowed inside.
  if (isFirstExchange && assistantInserted) {
    void generateAndPatchTitle(conv._id, body.content);
  }
});

export default router;
