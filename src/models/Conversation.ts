import { Schema, model, type Types, type HydratedDocument } from "mongoose";

export interface IConversation {
  userId: Types.ObjectId;
  title: string;
  messageCount: number;
  archived: boolean;
  archivedAt?: Date;
  lastMessageAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type ConversationDoc = HydratedDocument<IConversation> & { _id: Types.ObjectId };

const conversationSchema = new Schema<IConversation>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true, trim: true, maxlength: 200, default: "New chat" },
    messageCount: { type: Number, default: 0 },
    archived: { type: Boolean, default: false },
    archivedAt: { type: Date },
    lastMessageAt: { type: Date },
  },
  { timestamps: true },
);

conversationSchema.index({ userId: 1, updatedAt: -1 });
conversationSchema.index({ userId: 1, archived: 1, updatedAt: -1 });
// Hard-delete archived conversations after 90 days automatically
conversationSchema.index({ archivedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60, sparse: true });

export const Conversation = model<IConversation>("Conversation", conversationSchema);
