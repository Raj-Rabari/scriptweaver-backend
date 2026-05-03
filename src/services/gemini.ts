import { GoogleGenerativeAI, type Content } from "@google/generative-ai";
import { config } from "../config.js";
import { SYSTEM_INSTRUCTION } from "../system_prompt.js";

const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
  systemInstruction: SYSTEM_INSTRUCTION,
});

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export async function* streamReply(
  userInput: string,
  history: HistoryMessage[] = [],
): AsyncGenerator<string> {
  const geminiHistory: Content[] = history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const chat = geminiModel.startChat({ history: geminiHistory });
  const result = await chat.sendMessageStream(userInput);

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) yield text;
  }
}
