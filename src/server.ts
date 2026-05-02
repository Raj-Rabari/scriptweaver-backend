import express, { type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { connectDb } from "./db.js";
import authRouter from "./routes/auth.js";
import conversationsRouter from "./routes/conversations.js";
import generateRouter from "./routes/generate.js";
import { errorHandler, notFound } from "./middleware/error.js";

async function main(): Promise<void> {
  await connectDb();

  const app = express();

  app.use(helmet());
  app.use(pinoHttp({ logger, redact: ["req.headers.authorization"] }));
  app.use(
    cors({
      origin: config.CORS_ORIGIN,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "64kb" }));
  app.use(cookieParser());

  app.get("/healthz", (_req: Request, res: Response) => {
    const dbState = mongoose.connection.readyState; // 1 = connected
    res.status(dbState === 1 ? 200 : 503).json({
      status: dbState === 1 ? "ok" : "degraded",
      db: dbState,
    });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/conversations", conversationsRouter);
  app.use("/api", generateRouter);

  app.use(notFound);
  app.use(errorHandler);

  const server = app.listen(config.PORT, () => {
    logger.info(`Server is running on port ${config.PORT}`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close(() => {
      void mongoose.disconnect().then(() => process.exit(0));
    });
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
