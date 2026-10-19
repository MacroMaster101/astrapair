import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

class RedirectError extends Error {
  constructor(readonly url: string) {
    super(`redirect:${url}`);
  }
}

const fake = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  result: null as unknown,
}));

vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
  cookies: async () => ({ set: vi.fn(), delete: vi.fn() }),
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signInWithPassword: async (...args: unknown[]) => {
        fake.signInWithPassword(...args);
        return fake.result;
      },
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/analytics/track", () => ({ trackAfterResponse: vi.fn() }));

import { signIn } from "./actions";

function form(fields: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("email", "sam@example.com");
  fd.set("password", "a-good-long-password-1");
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

const failure = (error: {
  code?: string;
  status?: number;
  name?: string;
  message?: string;
}) => ({
  data: { user: null, session: null },
  error,
});

beforeEach(() => {
  fake.signInWithPassword.mockClear();
  fake.result = { data: { user: {}, session: {} }, error: null };
});

describe("signIn", () => {
  it("redirects to the dashboard on success, or to a safe next path", async () => {
    await expect(signIn({}, form())).rejects.toMatchObject({
      url: "/dashboard",
    });
    await expect(signIn({}, form({ next: "/partner" }))).rejects.toMatchObject({
      url: "/partner",
    });
    await expect(
      signIn({}, form({ next: "//evil.example" })),
    ).rejects.toMatchObject({ url: "/dashboard" });
  });

  it("does not call the auth server when the form is invalid", async () => {
    const state = await signIn({}, form({ email: "not-an-email" }));
    expect(state.fieldErrors?.email).toBeTruthy();
    expect(fake.signInWithPassword).not.toHaveBeenCalled();
  });

  it("says the email or password is wrong for a rejected login", async () => {
    fake.result = failure({ code: "invalid_credentials", status: 400 });
    expect(await signIn({}, form())).toEqual({
      error: "Incorrect email or password.",
      values: { email: "sam@example.com" },
    });
  });

  it("asks for email confirmation when the address is not confirmed", async () => {
    fake.result = failure({ code: "email_not_confirmed", status: 400 });
    const state = await signIn({}, form());
    expect(state.error).toBe(
      "Please confirm your email address first. Check your inbox for the link.",
    );
  });

  it("asks to wait when the auth server rate limits the login", async () => {
    fake.result = failure({ code: "over_request_rate_limit", status: 429 });
    const state = await signIn({}, form());
    expect(state.error).toBe(
      "Too many attempts. Please wait a few minutes and try again.",
    );
  });

  // An outage must not be reported as a wrong password: people would reset a
  // password that is fine, or give up on an account that works.
  it.each([
    ["the request never got an answer", 0],
    ["a bad gateway", 502],
    ["a service that is down", 503],
    ["a gateway timeout", 504],
    ["a server error", 500],
  ])(
    "says sign in is unavailable, not a wrong password, for %s",
    async (_name, status) => {
      fake.result = failure({ status });
      const state = await signIn({}, form());
      expect(state.error).toBe(
        "Sign in isn't available right now. Please try again in a few minutes.",
      );
      expect(state.error).not.toContain("Incorrect");
      expect(state.values).toEqual({ email: "sam@example.com" });
    },
  );

  // A network failure can reach the action with no status at all.
  it.each([
    [
      "a retryable fetch error",
      { name: "AuthRetryableFetchError", message: "Something went wrong" },
    ],
    ["a fetch failed message", { name: "Error", message: "fetch failed" }],
  ])(
    "says sign in is unavailable for %s with no status",
    async (_name, error) => {
      fake.result = failure(error);
      const state = await signIn({}, form());
      expect(state.error).toBe(
        "Sign in isn't available right now. Please try again in a few minutes.",
      );
    },
  );

  it("still says the password is wrong for an error with no status that is not a network failure", async () => {
    fake.result = failure({
      name: "AuthApiError",
      message: "Invalid login credentials",
    });
    expect((await signIn({}, form())).error).toBe(
      "Incorrect email or password.",
    );
  });
});
