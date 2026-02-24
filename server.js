import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { SYSTEM_PROMPT } from "./system_prompt.js";

dotenv.config();

const app = express();

app.use(cors({ origin: "http://localhost:4200" }));
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post("/api/generate-script", async (req, res) => {
  try {
    const { userInput } = req.body;

    if (!userInput) {
      return res.status(400).json({ error: "user input is required" });
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
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
