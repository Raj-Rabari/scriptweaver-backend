import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

// 5 requests per 15 minutes per IP — applied to /auth/login and /auth/signup
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." },
});

// 30 requests per minute per authenticated user — applied to POST /conversations/:id/messages
export const messagesRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req: Request) => req.userId ?? req.ip ?? "anonymous",
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many messages. Please slow down." },
});
