import { describe, expect, it } from "vitest";
import { getRouteAccess, onboardingTarget, safeNextPath } from "./routes";

describe("getRouteAccess", () => {
  it.each([
    ["/dashboard", "protected"],
    ["/settings/profile", "protected"],
    ["/onboarding", "protected"],
    ["/chart", "protected"],
    ["/chart/birth-details", "protected"],
    ["/partner", "protected"],
    ["/partner/anything", "protected"],
    ["/ask", "protected"],
    ["/ask/0d5b1d3e-6f4a-4a35-9a53-2f6a3f0c8d11", "protected"],
    ["/asking-is-public", "public"],
    ["/partnership-is-public", "public"],
    ["/login", "guest-only"],
    ["/signup", "guest-only"],
    ["/forgot-password", "guest-only"],
    ["/reset-password", "protected"],
    ["/", "public"],
    ["/legal/privacy", "public"],
    ["/dashboards-are-public", "public"],
  ])("%s is %s", (path, access) => {
    expect(getRouteAccess(path)).toBe(access);
  });
});

describe("safeNextPath", () => {
  it("keeps same-origin paths", () => {
    expect(safeNextPath("/settings?tab=1")).toBe("/settings?tab=1");
  });

  it.each([
    null,
    "",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r\n/evil.com",
    "/\t\\evil.com",
    " /x",
    "/x y",
    "/x\u0000",
    "/.//evil.com",
    "/%2e//evil.com",
    "/a/..//evil.com",
    "/..//evil.com",
    "/.///evil.com",
  ])("falls back for %j", (next) => {
    expect(safeNextPath(next)).toBe("/dashboard");
  });

  it.each(["/invite/abc?x=1", "/chart", "/settings?tab=1#top", "/"])(
    "passes %s through unchanged",
    (next) => {
      expect(safeNextPath(next)).toBe(next);
    },
  );

  it("keeps percent-encoded sequences as a same-origin path", () => {
    const result = safeNextPath("/%09/evil.com");
    expect(result).toBe("/%09/evil.com");
    expect(result.startsWith("//")).toBe(false);
    expect(new URL(result, "https://app.test").origin).toBe("https://app.test");
  });

  it.each(["/%2F%2Fevil.com", "/%5Cevil.com"])(
    "keeps %s as a same-origin path",
    (next) => {
      const result = safeNextPath(next);
      expect(result).toBe(next);
      expect(result.startsWith("//")).toBe(false);
      expect(new URL(result, "https://app.test").origin).toBe(
        "https://app.test",
      );
    },
  );

  it("normalises dot segments", () => {
    expect(safeNextPath("/a/../b")).toBe("/b");
  });
});

describe("safeNextPath with an explicit fallback", () => {
  it("returns the fallback for an empty string", () => {
    expect(safeNextPath("", "")).toBe("");
    expect(safeNextPath("", "/onboarding")).toBe("/onboarding");
  });
});

describe("onboardingTarget", () => {
  it("is plain /onboarding without a next", () => {
    expect(onboardingTarget(null)).toBe("/onboarding");
    expect(onboardingTarget("")).toBe("/onboarding");
  });

  it("carries a safe next as an encoded query", () => {
    expect(onboardingTarget("/invite/abc")).toBe(
      "/onboarding?next=%2Finvite%2Fabc",
    );
  });

  it("drops an unsafe next", () => {
    expect(onboardingTarget("https://evil")).toBe("/onboarding");
    expect(onboardingTarget("//evil.example")).toBe("/onboarding");
  });
});
