import { describe, expect, it } from "vitest";
import { getRouteAccess, safeNextPath } from "./routes";

describe("getRouteAccess", () => {
  it.each([
    ["/dashboard", "protected"],
    ["/settings/profile", "protected"],
    ["/onboarding", "protected"],
    ["/login", "guest-only"],
    ["/signup", "guest-only"],
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
  ])("falls back for %s", (next) => {
    expect(safeNextPath(next)).toBe("/dashboard");
  });
});
