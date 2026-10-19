import "server-only";
import { createHash, randomBytes } from "node:crypto";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 32 random bytes as base64url. Only the hash is stored; the token is shown once. */
export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

export function isWellFormedToken(token: string): boolean {
  return TOKEN_RE.test(token);
}
