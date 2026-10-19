import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.hoisted(() => vi.fn());
// The cookie handlers the proxy gives to the Supabase client, so a test can
// set a cookie the way the library does while it refreshes a session.
type CookieHandlers = {
  setAll: (
    cookies: { name: string; value: string; options?: object }[],
    headers: Record<string, string>,
  ) => void;
};
const handlers = vi.hoisted(() => ({ current: null as CookieHandlers | null }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: { cookies: CookieHandlers },
  ) => {
    handlers.current = options.cookies;
    return { auth: { getClaims } };
  },
}));
vi.mock("@/lib/env", () => ({
  getPublicEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-key",
  }),
}));

import { updateSession } from "./proxy";

function request(path: string) {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

const outageError = Object.assign(new Error("fetch failed"), {
  name: "AuthRetryableFetchError",
  status: 0,
});

describe("updateSession during an auth outage", () => {
  beforeEach(() => {
    getClaims.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  // supabase-js normally returns the failure instead of throwing.
  describe("when getClaims returns a network error", () => {
    beforeEach(() => {
      getClaims.mockResolvedValue({ data: null, error: outageError });
    });

    it("treats a protected page as signed out and sends the visitor to sign in", async () => {
      const response = await updateSession(request("/dashboard?tab=1"));
      expect(response.status).toBe(307);
      const location = new URL(response.headers.get("location")!);
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("next")).toBe("/dashboard?tab=1");
    });

    it("lets a public page through", async () => {
      const response = await updateSession(request("/"));
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
    });

    it("lets the sign-in page render", async () => {
      const response = await updateSession(request("/login"));
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
    });
  });

  // Anything the library does not turn into a result must not become a 500.
  describe("when getClaims throws", () => {
    beforeEach(() => {
      getClaims.mockRejectedValue(new TypeError("fetch failed"));
    });

    it("treats a protected page as signed out instead of crashing", async () => {
      const response = await updateSession(request("/settings"));
      expect(response.status).toBe(307);
      const location = new URL(response.headers.get("location")!);
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("next")).toBe("/settings");
    });

    it("lets public and sign-in pages through", async () => {
      for (const path of ["/", "/legal/privacy", "/login", "/signup"]) {
        const response = await updateSession(request(path));
        expect(response.status, path).toBe(200);
      }
    });

    it("carries cookies set before the throw onto the sign-in redirect", async () => {
      getClaims.mockImplementation(async () => {
        handlers.current!.setAll(
          [{ name: "sb-session", value: "refreshed", options: { path: "/" } }],
          { "cache-control": "private, no-cache, no-store" },
        );
        throw new TypeError("fetch failed");
      });
      const response = await updateSession(request("/settings"));
      expect(response.status).toBe(307);
      expect(response.cookies.get("sb-session")?.value).toBe("refreshed");
      expect(response.headers.get("cache-control")).toBe(
        "private, no-cache, no-store",
      );
    });

    it("keeps cookies set before the throw on a page that is let through", async () => {
      getClaims.mockImplementation(async () => {
        handlers.current!.setAll(
          [{ name: "sb-session", value: "refreshed", options: { path: "/" } }],
          {},
        );
        throw new TypeError("fetch failed");
      });
      const response = await updateSession(request("/"));
      expect(response.status).toBe(200);
      expect(response.cookies.get("sb-session")?.value).toBe("refreshed");
    });

    it("logs a fixed message without the error text", async () => {
      await updateSession(request("/"));
      const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
      expect(logged).toContain("Session check failed");
      expect(logged).not.toContain("fetch failed");
    });
  });

  it("still treats a valid session as signed in", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: "user-1" } },
      error: null,
    });
    expect((await updateSession(request("/dashboard"))).status).toBe(200);
    const fromLogin = await updateSession(request("/login"));
    expect(fromLogin.status).toBe(307);
    expect(new URL(fromLogin.headers.get("location")!).pathname).toBe(
      "/dashboard",
    );
  });
});
