import { Router, type Request, type Response } from "express";
import { z } from "zod";
import mongoose, { type Types } from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { Conversation, type IConversation } from "../models/Conversation.js";
import { Message, type IMessage } from "../models/Message.js";

type ConversationLean = IConversation & { _id: Types.ObjectId };
type MessageLean = IMessage & { _id: Types.ObjectId };

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
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

// POST /conversations
router.post("/", async (req: Request, res: Response) => {
  const body = createSchema.parse(req.body);

  const conv = await Conversation.create({
    userId: req.userId,
    title: body.title ?? "New chat",
  });

  res.status(201).json({ conversation: publicConversation(conv.toObject() as ConversationLean) });
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
  if (body.archived !== undefined) conv.archived = body.archived;
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

export default router;
