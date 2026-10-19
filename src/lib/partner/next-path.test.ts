import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  inviteNextCookieOptions,
  invitePath,
  parseInvitePath,
  resolveOnboardingNext,
} from "./next-path";

const TOKEN = "A".repeat(43);

describe("parseInvitePath", () => {
  it("accepts exactly /invite/<well-formed token>", () => {
    expect(parseInvitePath(invitePath(TOKEN))).toBe(`/invite/${TOKEN}`);
  });

  it.each([
    null,
    undefined,
    "",
    "/dashboard",
    "/invite/short",
    `/invite/${TOKEN}extra`,
    `/invite/${TOKEN}/more`,
    `/invite/${TOKEN}?x=1`,
    `//invite/${TOKEN}`,
    `https://evil.example/invite/${TOKEN}`,
    `/invite/${"!".repeat(43)}`,
  ])("rejects %s", (value) => {
    expect(parseInvitePath(value)).toBeNull();
  });
});

describe("resolveOnboardingNext", () => {
  it("prefers a safe explicit next", () => {
    expect(resolveOnboardingNext("/dashboard", invitePath(TOKEN))).toBe(
      "/dashboard",
    );
  });

  it("falls back to a valid invite cookie", () => {
    expect(resolveOnboardingNext(null, invitePath(TOKEN))).toBe(
      invitePath(TOKEN),
    );
    expect(resolveOnboardingNext("https://evil", invitePath(TOKEN))).toBe(
      invitePath(TOKEN),
    );
  });

  it("ignores anything else in the cookie", () => {
    expect(resolveOnboardingNext(null, "/settings")).toBeNull();
    expect(resolveOnboardingNext(null, undefined)).toBeNull();
  });
});

describe("inviteNextCookieOptions", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is httpOnly, lax, root scoped and lasts 7 days", () => {
    expect(inviteNextCookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 604800,
    });
  });

  it("is secure only in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(inviteNextCookieOptions().secure).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    expect(inviteNextCookieOptions().secure).toBe(false);
  });
});
