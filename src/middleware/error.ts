import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: "Not found" });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) {
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Validation failed",
      details: err.issues.map((i) => ({ path: i.path, message: i.message })),
    });
    return;
  }

  if (err instanceof Error && err.name === "MongoServerError") {
    const code = (err as Error & { code?: number }).code;
    if (code === 11000) {
      res.status(409).json({ error: "Resource already exists" });
      return;
    }
  }

  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
}
