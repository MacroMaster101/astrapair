import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  generateInviteToken,
  hashInviteToken,
  isWellFormedToken,
} from "./token";

describe("invite tokens", () => {
  it("generates 43-char base64url tokens with a sha256 hex hash", () => {
    const { token, tokenHash } = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(token)).toBe(tokenHash);
  });

  it("never repeats", () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => generateInviteToken().token),
    );
    expect(tokens.size).toBe(50);
  });

  it("validates token shape", () => {
    expect(isWellFormedToken(generateInviteToken().token)).toBe(true);
    expect(isWellFormedToken("short")).toBe(false);
    expect(isWellFormedToken("a".repeat(42) + "!")).toBe(false);
  });
});
