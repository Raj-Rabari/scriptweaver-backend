import {
  Router,
  type Request,
  type Response,
  type CookieOptions,
} from "express";
import { z } from "zod";
import { config } from "../config.js";
import { User, type UserDoc } from "../models/User.js";
import { hashPassword, verifyPassword } from "../services/passwords.js";
import {
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshTokenByRaw,
  signAccessToken,
  RefreshTokenError,
} from "../services/tokens.js";
import { requireAuth } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { authRateLimit } from "../middleware/rateLimit.js";

const REFRESH_COOKIE = "sw_refresh";

function refreshCookieOptions(expiresAt?: Date): CookieOptions {
  const opts: CookieOptions = {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "lax",
    path: "/",
  };
  if (config.COOKIE_DOMAIN) opts.domain = config.COOKIE_DOMAIN;
  if (expiresAt) opts.expires = expiresAt;
  return opts;
}

function publicUser(u: UserDoc) {
  return {
    id: u._id.toString(),
    email: u.email,
    name: u.name,
    createdAt: u.createdAt,
  };
}

const signupSchema = z.object({
  email: z.string().email().max(254).toLowerCase(),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(80),
});

const loginSchema = z.object({
  email: z.string().email().max(254).toLowerCase(),
  password: z.string().min(1).max(128),
});

const router = Router();

router.post("/signup", authRateLimit, async (req: Request, res: Response) => {
  const body = signupSchema.parse(req.body);
  const passwordHash = await hashPassword(body.password);

  let user: UserDoc;
  try {
    user = await User.create({
      email: body.email,
      passwordHash,
      name: body.name,
      lastLoginAt: new Date(),
      status: "active",
      quota: { conversations: 0, messages: 0 },
    });
  } catch (err) {
    if (
      err instanceof Error &&
      (err as Error & { code?: number }).code === 11000
    ) {
      throw new HttpError(409, "Email already registered");
    }
    throw err;
  }

  const refresh = await issueRefreshToken({
    userId: user._id,
    userAgent: req.get("user-agent"),
    ip: req.ip,
  });
  const accessToken = signAccessToken(user._id.toString());

  res.cookie(
    REFRESH_COOKIE,
    refresh.raw,
    refreshCookieOptions(refresh.expiresAt),
  );
  res.status(201).json({ user: publicUser(user), accessToken });
});

router.post("/login", authRateLimit, async (req: Request, res: Response) => {
  const body = loginSchema.parse(req.body);

  const user = await User.findOne({ email: body.email });
  if (!user || user.status !== "active") {
    throw new HttpError(401, "Invalid credentials");
  }

  const ok = await verifyPassword(body.password, user.passwordHash);
  if (!ok) {
    throw new HttpError(401, "Invalid credentials");
  }

  user.lastLoginAt = new Date();
  await user.save();

  const refresh = await issueRefreshToken({
    userId: user._id,
    userAgent: req.get("user-agent"),
    ip: req.ip,
  });
  const accessToken = signAccessToken(user._id.toString());

  res.cookie(
    REFRESH_COOKIE,
    refresh.raw,
    refreshCookieOptions(refresh.expiresAt),
  );
  res.json({ user: publicUser(user), accessToken });
});

router.post("/refresh", async (req: Request, res: Response) => {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (!raw || typeof raw !== "string") {
    throw new HttpError(401, "Missing refresh token");
  }

  let result;
  try {
    result = await rotateRefreshToken({
      raw,
      userAgent: req.get("user-agent"),
      ip: req.ip,
    });
  } catch (err) {
    if (err instanceof RefreshTokenError) {
      res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
      throw new HttpError(401, err.message);
    }
    throw err;
  }

  const accessToken = signAccessToken(result.userId.toString());
  res.cookie(
    REFRESH_COOKIE,
    result.next.raw,
    refreshCookieOptions(result.next.expiresAt),
  );
  res.json({ accessToken });
});

router.post("/logout", async (req: Request, res: Response) => {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (typeof raw === "string" && raw.length > 0) {
    await revokeRefreshTokenByRaw(raw);
  }
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
  res.status(204).end();
});

router.get("/me", requireAuth, async (req: Request, res: Response) => {
  const user = await User.findById(req.userId);
  if (!user) {
    throw new HttpError(401, "User not found");
  }
  res.json({ user: publicUser(user) });
});

export default router;
