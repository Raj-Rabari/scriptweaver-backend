import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Types } from "mongoose";
import { config } from "../config.js";
import { Conversation } from "../models/Conversation.js";

const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);
const titleModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// Called fire-and-forget from the messages route on the first exchange.
// Errors are swallowed so they never bubble to the HTTP response.
export async function generateAndPatchTitle(
  conversationId: Types.ObjectId,
  firstUserMessage: string,
): Promise<void> {
  try {
    const result = await titleModel.generateContent(
      `Generate a short title (5 words or fewer) for a conversation that starts with this message. ` +
        `Reply with ONLY the title — no punctuation at the end, no quotes.\n\n` +
        `Message: "${firstUserMessage.slice(0, 300)}"`,
    );
    const raw = result.response.text().trim();
    const title = raw.replace(/^["']|["']$/g, "").trim().slice(0, 100);
    if (title) {
      await Conversation.updateOne({ _id: conversationId }, { $set: { title } });
    }
  } catch (err) {
    console.error("Title generation failed:", err);
  }
}
