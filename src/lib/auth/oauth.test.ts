import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isGoogleAuthEnabled, oauthErrorMessage } from "./oauth";

afterEach(() => vi.unstubAllEnvs());

describe("isGoogleAuthEnabled", () => {
  it("is on by default", () => {
    vi.stubEnv("GOOGLE_AUTH", undefined);
    expect(isGoogleAuthEnabled()).toBe(true);
  });

  it.each(["on", "ON", "", "  ", "true", "1", "yes", "off now", "of"])(
    "stays on for %j",
    (value) => {
      vi.stubEnv("GOOGLE_AUTH", value);
      expect(isGoogleAuthEnabled()).toBe(true);
    },
  );

  it.each(["off", "OFF", "Off", "  off  ", "\toff\n"])(
    "is off for %j",
    (value) => {
      vi.stubEnv("GOOGLE_AUTH", value);
      expect(isGoogleAuthEnabled()).toBe(false);
    },
  );
});

describe("oauthErrorMessage", () => {
  it("has plain copy for every allowlisted code", () => {
    expect(oauthErrorMessage("oauth_no_account")).toBe(
      "There's no AstraPair account for that Google email yet. Create an account with your invite code first, then you can sign in with Google.",
    );
    for (const code of [
      "oauth_unavailable",
      "oauth_failed",
      "oauth_rate_limited",
    ]) {
      const message = oauthErrorMessage(code);
      expect(message, code).toBeTruthy();
      expect(message).not.toMatch(/[–—]/);
    }
    expect(oauthErrorMessage("oauth_rate_limited")).toBe(
      "Too many attempts. Please wait a few minutes and try again.",
    );
  });

  it.each([
    null,
    undefined,
    "",
    "link_invalid",
    "OAUTH_FAILED",
    " oauth_failed",
    "access_denied",
    "<script>alert(1)</script>",
    "constructor",
    "toString",
    "__proto__",
    "hasOwnProperty",
  ])("returns null for %j", (code) => {
    expect(oauthErrorMessage(code)).toBeNull();
  });
});
