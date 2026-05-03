import crypto from "node:crypto";
import jwt, { type Secret, type SignOptions } from "jsonwebtoken";
import { Types } from "mongoose";
import { config } from "../config.js";
import { RefreshToken, type RefreshTokenDoc } from "../models/RefreshToken.js";

export interface AccessTokenPayload {
  sub: string;
}

export function signAccessToken(userId: string): string {
  const opts: SignOptions = {
    expiresIn: config.ACCESS_TOKEN_TTL as SignOptions["expiresIn"],
  };
  return jwt.sign({ sub: userId }, config.JWT_ACCESS_SECRET as Secret, opts);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET as Secret);
  if (typeof decoded === "string" || typeof decoded.sub !== "string") {
    throw new Error("Invalid access token payload");
  }
  return { sub: decoded.sub };
}

function generateRawToken(): string {
  return crypto.randomBytes(48).toString("base64url");
}

function hashToken(raw: string): string {
  return crypto.createHmac("sha256", config.JWT_REFRESH_SECRET).update(raw).digest("hex");
}

export interface IssuedRefresh {
  raw: string;
  doc: RefreshTokenDoc;
  expiresAt: Date;
}

export async function issueRefreshToken(args: {
  userId: Types.ObjectId;
  family?: Types.ObjectId;
  userAgent?: string;
  ip?: string;
}): Promise<IssuedRefresh> {
  const raw = generateRawToken();
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  const family = args.family ?? new Types.ObjectId();

  const doc = await RefreshToken.create({
    userId: args.userId,
    tokenHash,
    family,
    userAgent: args.userAgent,
    ip: args.ip,
    expiresAt,
  });

  return { raw, doc, expiresAt };
}

export interface RotationResult {
  userId: Types.ObjectId;
  next: IssuedRefresh;
}

export async function rotateRefreshToken(args: {
  raw: string;
  userAgent?: string;
  ip?: string;
}): Promise<RotationResult> {
  const tokenHash = hashToken(args.raw);
  const existing = await RefreshToken.findOne({ tokenHash });

  if (!existing) {
    throw new RefreshTokenError("Refresh token not found");
  }

  if (existing.revokedAt) {
    await RefreshToken.updateMany(
      { family: existing.family, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date() } },
    );
    throw new RefreshTokenError("Refresh token reuse detected; family revoked");
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    throw new RefreshTokenError("Refresh token expired");
  }

  const next = await issueRefreshToken({
    userId: existing.userId,
    family: existing.family,
    userAgent: args.userAgent,
    ip: args.ip,
  });

  await RefreshToken.updateOne(
    { _id: existing._id },
    { $set: { revokedAt: new Date(), replacedBy: next.doc._id } },
  );

  return { userId: existing.userId, next };
}

export async function revokeRefreshTokenByRaw(raw: string): Promise<void> {
  const tokenHash = hashToken(raw);
  await RefreshToken.updateOne(
    { tokenHash, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
}

export class RefreshTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefreshTokenError";
  }
}
