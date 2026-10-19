import { tryToParsePath } from "next/dist/lib/try-to-parse-path";
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/proxy", () => ({ updateSession: vi.fn() }));

import { updateSession } from "@/lib/supabase/proxy";
import { config, proxy } from "./proxy";

// Compiled the way Next compiles a middleware matcher, so the test sees the
// same regular expression (including its trailing slash and hash handling).
const parsed = tryToParsePath(config.matcher[0]);
const matcher = new RegExp(parsed.regexStr ?? "(?!)");

describe("proxy matcher", () => {
  it("compiles with Next's own matcher parser", () => {
    expect(parsed.error).toBeUndefined();
    expect(parsed.regexStr).toBeTruthy();
  });

  it("skips the health endpoint so it does not need Supabase env", () => {
    expect(matcher.test("/api/health")).toBe(false);
  });

  it.each([
    "/",
    "/dashboard",
    "/api/places",
    "/api/health/extra",
    "/api/healthz",
    "/login",
  ])("still runs for %s", (path) => {
    expect(matcher.test(path)).toBe(true);
  });

  // Never skipped by extension: these are app pages or the app 404 and must
  // get the CSP, so a file-looking URL cannot dodge the policy.
  it.each([
    "/invite/aaa.png",
    "/invite/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.svg",
    "/dashboard/x.png",
    "/login/x.svg",
    "/nope.png",
    "/nope.jpg",
    "/a/b/c.gif",
    "/x.webp",
    "/x.ico",
    "/legal/privacy.png",
    "/api/places.png",
    "/api/health.png",
    "/brand",
    "/images",
    "/animations",
    "/icon.png/extra",
    "/xfavicon.ico",
    "/faviconxico",
    "/iconxpng",
  ])("runs for file-looking or lookalike path %s", (path) => {
    expect(matcher.test(path)).toBe(true);
  });

  it.each([
    "/_next/static/x.js",
    "/_next/static/media/a.woff2",
    "/_next/image",
    "/favicon.ico",
    "/icon.png",
    "/apple-icon.png",
    "/brand/astrapair-mark.webp",
    "/images/celestial-pair.png",
    "/animations/connection-orbit-dark.gif",
  ])("skips static path %s", (path) => {
    expect(matcher.test(path)).toBe(false);
  });
});

describe("proxy content security policy", () => {
  const mocked = vi.mocked(updateSession);

  beforeEach(() => {
    mocked.mockReset();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
  });

  const run = (path = "/") => {
    const request = new NextRequest(`http://localhost:3000${path}`);
    return { request, response: proxy(request) };
  };
  const nonceOf = (csp: string | null) =>
    /'nonce-([^']+)'/.exec(csp ?? "")?.[1];

  it("sets the policy on a pass-through response", async () => {
    mocked.mockResolvedValue(NextResponse.next());
    const { response } = run();
    const csp = (await response).headers.get("content-security-policy");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self' https://abc.supabase.co");
    expect(nonceOf(csp)).toBeTruthy();
  });

  it("sets the policy on a redirect from updateSession", async () => {
    mocked.mockResolvedValue(
      NextResponse.redirect("http://localhost:3000/login"),
    );
    const res = await run("/dashboard").response;
    expect(res.status).toBe(307);
    expect(res.headers.get("content-security-policy")).toContain(
      "script-src 'self' 'nonce-",
    );
  });

  it("forwards the same nonce and policy on the request headers", async () => {
    mocked.mockResolvedValue(NextResponse.next());
    const { request, response } = run();
    const csp = (await response).headers.get("content-security-policy");
    expect(request.headers.get("content-security-policy")).toBe(csp);
    expect(request.headers.get("x-nonce")).toBe(nonceOf(csp));
  });

  it("hands updateSession the request after the headers are set", async () => {
    let seen: string | null = null;
    mocked.mockImplementation(async (request) => {
      // updateSession builds its responses from these request headers.
      seen = request.headers.get("x-nonce");
      return NextResponse.next();
    });
    await run().response;
    expect(seen).toBeTruthy();
  });

  it("keeps cookies and cache headers from updateSession", async () => {
    const res = NextResponse.next();
    res.cookies.set("sb-token", "refreshed");
    res.headers.set("cache-control", "private, no-store");
    mocked.mockResolvedValue(res);
    const out = await run().response;
    expect(out.cookies.get("sb-token")?.value).toBe("refreshed");
    expect(out.headers.get("cache-control")).toBe("private, no-store");
  });

  it("uses a different nonce for every request", async () => {
    mocked.mockImplementation(async () => NextResponse.next());
    const first = nonceOf(
      (await run().response).headers.get("content-security-policy"),
    );
    const second = nonceOf(
      (await run().response).headers.get("content-security-policy"),
    );
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it("overwrites a policy or nonce sent by the client", async () => {
    mocked.mockResolvedValue(NextResponse.next());
    const request = new NextRequest("http://localhost:3000/", {
      headers: {
        "x-nonce": "attacker",
        "content-security-policy": "script-src *",
      },
    });
    const res = await proxy(request);
    expect(request.headers.get("x-nonce")).not.toBe("attacker");
    expect(res.headers.get("content-security-policy")).not.toContain("*");
  });

  it("upgrades insecure requests only for https requests", async () => {
    mocked.mockImplementation(async () => NextResponse.next());
    const policyFor = async (
      url: string,
      headers: Record<string, string> = {},
    ) =>
      (await proxy(new NextRequest(url, { headers }))).headers.get(
        "content-security-policy",
      );

    expect(await policyFor("http://localhost:3000/")).not.toContain(
      "upgrade-insecure-requests",
    );
    expect(
      await policyFor("http://localhost:3000/", {
        "x-forwarded-proto": "https",
      }),
    ).toContain("upgrade-insecure-requests");
    expect(
      await policyFor("http://localhost:3000/", {
        "x-forwarded-proto": " HTTPS , http",
      }),
    ).toContain("upgrade-insecure-requests");
    expect(
      await policyFor("http://localhost:3000/", {
        "x-forwarded-proto": "http, https",
      }),
    ).not.toContain("upgrade-insecure-requests");
    expect(await policyFor("https://example.test/")).toContain(
      "upgrade-insecure-requests",
    );
  });

  it("adds the Sentry ingest origin only when a DSN is configured", async () => {
    mocked.mockResolvedValue(NextResponse.next());
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://k@o1.ingest.sentry.io/2");
    const csp = (await run().response).headers.get("content-security-policy");
    expect(csp).toContain("https://o1.ingest.sentry.io");
  });
});
