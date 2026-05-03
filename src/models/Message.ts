import { Schema, model, type Types, type HydratedDocument } from "mongoose";

export interface IMessage {
  conversationId: Types.ObjectId;
  userId: Types.ObjectId;
  role: "user" | "assistant";
  content: string;
  truncated: boolean;
  tokensIn?: number;
  tokensOut?: number;
  createdAt: Date;
}

export type MessageDoc = HydratedDocument<IMessage> & { _id: Types.ObjectId };

const messageSchema = new Schema<IMessage>(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true, maxlength: 16384 },
    truncated: { type: Boolean, default: false },
    tokensIn: { type: Number },
    tokensOut: { type: Number },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false } },
);

messageSchema.index({ conversationId: 1, createdAt: 1 });

export const Message = model<IMessage>("Message", messageSchema);
