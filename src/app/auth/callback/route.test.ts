import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: fake.createClient }));

import { GET } from "./route";

const ORIGIN = "https://astrapair.test";

function call(query: string) {
  return GET(new NextRequest(`${ORIGIN}/auth/callback${query}`));
}

function location(response: Response) {
  expect(response.status).toBeGreaterThanOrEqual(300);
  expect(response.status).toBeLessThan(400);
  return response.headers.get("location");
}

beforeEach(() => {
  fake.exchangeCodeForSession.mockReset();
  fake.exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
  fake.createClient.mockReset();
  fake.createClient.mockResolvedValue({
    auth: { exchangeCodeForSession: fake.exchangeCodeForSession },
  });
});

describe("GET /auth/callback success", () => {
  it("exchanges the code and continues to the validated next path", async () => {
    const res = await call("?code=abc&next=%2Fchart");
    expect(location(res)).toBe(`${ORIGIN}/chart`);
    expect(fake.exchangeCodeForSession).toHaveBeenCalledWith("abc");
  });

  it("falls back to the dashboard without a next path", async () => {
    expect(location(await call("?code=abc"))).toBe(`${ORIGIN}/dashboard`);
  });

  it.each(["//evil.example", "https://evil.example", "/\\evil.example"])(
    "never leaves the site for next=%s",
    async (next) => {
      const res = await call(`?code=abc&next=${encodeURIComponent(next)}`);
      expect(location(res)).toBe(`${ORIGIN}/dashboard`);
    },
  );

  it("keeps a query string on next", async () => {
    const next = "/onboarding?next=/invite/abc";
    const res = await call(`?code=abc&next=${encodeURIComponent(next)}`);
    expect(location(res)).toBe(`${ORIGIN}${next}`);
  });
});

describe("GET /auth/callback failures from the Google flow", () => {
  const G = "&flow=google";

  it("sends a provider error to oauth_failed without exchanging anything", async () => {
    const res = await call(
      `?error=access_denied&error_description=User+denied+access&code=abc${G}`,
    );
    expect(location(res)).toBe(`${ORIGIN}/login?error=oauth_failed`);
    expect(fake.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("treats error_description alone as an error", async () => {
    const res = await call(`?error_description=Something+went+wrong${G}`);
    expect(location(res)).toBe(`${ORIGIN}/login?error=oauth_failed`);
  });

  it.each([
    "?error=server_error&error_description=beta_code_invalid",
    "?error=access_denied&error_description=Error+running+hook+URI%3A+beta_code_invalid",
    "?error_description=Hook+rejected%3A+beta_code_invalid%3A+nope",
  ])("maps the hook's rejection to oauth_no_account (%s)", async (query) => {
    expect(location(await call(`${query}${G}`))).toBe(
      `${ORIGIN}/login?error=oauth_no_account`,
    );
  });

  it("maps a failed code exchange to oauth_failed", async () => {
    fake.exchangeCodeForSession.mockResolvedValue({
      data: {},
      error: { status: 400, message: "invalid flow state" },
    });
    expect(location(await call(`?code=abc&next=%2Fchart${G}`))).toBe(
      `${ORIGIN}/login?error=oauth_failed`,
    );
  });

  it("maps an exception while exchanging to oauth_failed", async () => {
    fake.exchangeCodeForSession.mockRejectedValue(new Error("network down"));
    expect(location(await call(`?code=abc${G}`))).toBe(
      `${ORIGIN}/login?error=oauth_failed`,
    );
    fake.createClient.mockRejectedValue(new Error("no cookies"));
    expect(location(await call(`?code=abc${G}`))).toBe(
      `${ORIGIN}/login?error=oauth_failed`,
    );
  });

  it("still succeeds to next when the code is good", async () => {
    expect(location(await call(`?code=abc&next=%2Fchart${G}`))).toBe(
      `${ORIGIN}/chart`,
    );
  });

  it("keeps link_invalid for a visit with no code and no error", async () => {
    expect(location(await call(`?flow=google`))).toBe(
      `${ORIGIN}/login?error=link_invalid`,
    );
  });

  it("never reflects the provider's description into the redirect", async () => {
    const hostile = [
      "<script>alert(1)</script>",
      "https://evil.example/phish",
      "oauth_no_account",
      "beta_code_invalid&error=oauth_no_account",
      "line one\r\nSet-Cookie: x=1",
    ];
    for (const description of hostile) {
      const query = `?error=access_denied&error_description=${encodeURIComponent(description)}${G}`;
      const target = location(await call(query)) ?? "";
      const url = new URL(target);
      expect(url.origin).toBe(ORIGIN);
      expect(url.pathname).toBe("/login");
      expect([...url.searchParams.keys()]).toEqual(["error"]);
      expect(["oauth_failed", "oauth_no_account"]).toContain(
        url.searchParams.get("error"),
      );
      expect(target).not.toContain("script");
      expect(target).not.toContain("evil");
      expect(target).not.toContain("Set-Cookie");
    }
  });

  it("puts only the allowlisted code, never next or the provider's error, in the URL", async () => {
    const res = await call(
      `?error=access_denied&error_description=nope&next=%2Fchart${G}`,
    );
    expect(location(res)).toBe(`${ORIGIN}/login?error=oauth_failed`);
  });

  it.each(["google ", "GOOGLE", "true", "1", ""])(
    "treats flow=%j as no marker",
    async (flow) => {
      const res = await call(
        `?error=access_denied&error_description=nope&flow=${encodeURIComponent(flow)}`,
      );
      expect(location(res)).toBe(`${ORIGIN}/login?error=link_invalid`);
    },
  );
});

describe("GET /auth/callback failures without the Google marker (email links)", () => {
  it("keeps link_invalid for a failed code exchange", async () => {
    fake.exchangeCodeForSession.mockResolvedValue({
      data: {},
      error: { status: 400, message: "invalid flow state" },
    });
    expect(location(await call("?code=abc"))).toBe(
      `${ORIGIN}/login?error=link_invalid`,
    );
  });

  it("keeps link_invalid for an exception while exchanging", async () => {
    fake.exchangeCodeForSession.mockRejectedValue(new Error("network down"));
    expect(location(await call("?code=abc"))).toBe(
      `${ORIGIN}/login?error=link_invalid`,
    );
  });

  it("keeps link_invalid for an expired link reported by the auth server", async () => {
    const res = await call(
      "?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    expect(location(res)).toBe(`${ORIGIN}/login?error=link_invalid`);
    expect(fake.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("never turns a provider error or the hook message into an oauth code", async () => {
    for (const query of [
      "?error=server_error&error_description=beta_code_invalid",
      "?error=access_denied&error_description=nope",
      "?error_description=beta_code_invalid",
    ]) {
      expect(location(await call(query)), query).toBe(
        `${ORIGIN}/login?error=link_invalid`,
      );
    }
  });

  it("keeps link_invalid for a visit with no code and no error", async () => {
    expect(location(await call(""))).toBe(`${ORIGIN}/login?error=link_invalid`);
    expect(fake.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
