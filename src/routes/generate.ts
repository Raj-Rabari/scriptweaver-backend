import { Router, type Request, type Response } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../config.js";
import { SYSTEM_PROMPT } from "../system_prompt.js";

const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);

interface GenerateScriptBody {
  userInput?: string;
}

const router = Router();

router.post(
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
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to generate script" });
      } else {
        res.end();
      }
    }
  },
);

export default router;
