import express, { type Request, type Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { SYSTEM_PROMPT } from "./system_prompt.js";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("GEMINI_API_KEY is required");
}

const allowedOrigin = process.env.CORS_ORIGIN ?? "http://localhost:4200";
const port = Number(process.env.PORT) || 3000;

const app = express();

app.use(cors({ origin: allowedOrigin }));
app.use(express.json());

const genAI = new GoogleGenerativeAI(apiKey);

interface GenerateScriptBody {
  userInput?: string;
}

app.post(
  "/generate-script",
  async (
    req: Request<unknown, unknown, GenerateScriptBody>,
    res: Response,
  ): Promise<void> => {
    try {
      const { userInput } = req.body;

      if (!userInput) {
        res.status(400).json({ error: "user input is required" });
        return;
      }

      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Transfer-Encoding", "chunked");

      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const prompt = SYSTEM_PROMPT.replace("${userInput}", userInput);

      const result = await model.generateContentStream(prompt);

      for await (const chunk of result.stream) {
        res.write(chunk.text());
      }

      res.end();
    } catch (error) {
      console.error("error generating script:", error);
      res.status(500).json({ error: "Failed to generate script" });
    }
  },
);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
