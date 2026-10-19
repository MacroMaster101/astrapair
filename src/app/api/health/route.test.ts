import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/health", () => {
  it("returns ok with the release and no caching", async () => {
    vi.stubEnv("NEXT_PUBLIC_RELEASE", "rel-9");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "ok", release: "rel-9" });
  });

  it("exposes nothing else", async () => {
    vi.stubEnv("SENTRY_DSN", "https://k@o1.ingest.sentry.io/1");
    vi.stubEnv("SUPABASE_SECRET_KEY", "super-secret-value");
    const text = JSON.stringify(await (await GET()).json());
    expect(text).not.toContain("sentry.io");
    expect(text).not.toContain("super-secret-value");
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["release", "status"]);
  });
});
