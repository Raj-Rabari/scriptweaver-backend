import { Schema, model, type Types, type HydratedDocument } from "mongoose";

export interface IUser {
  email: string;
  passwordHash: string;
  name: string;
  status: "active" | "disabled";
  lastLoginAt?: Date;
  quota: {
    conversations: number;
    messages: number;
  };
  createdAt: Date;
}

export type UserDoc = HydratedDocument<IUser> & { _id: Types.ObjectId };

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    lastLoginAt: { type: Date },
    status: {
      type: String,
      enum: ["active", "disabled"],
      default: "active",
      required: true,
    },
    quota: {
      conversations: { type: Number, default: 0 },
      messages: { type: Number, default: 0 },
    },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false } },
);

export const User = model<IUser>("User", userSchema);
