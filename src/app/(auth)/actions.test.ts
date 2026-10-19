import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

class RedirectError extends Error {
  constructor(readonly url: string) {
    super(`redirect:${url}`);
  }
}

type SignUpResult = {
  data: {
    user: { id: string; identities?: unknown[] } | null;
    session: unknown;
  };
  error: { code?: string; status?: number; message?: string } | null;
};

const fake = vi.hoisted(() => ({
  signUpResult: null as unknown,
  signUp: vi.fn(),
  trackAfterResponse: vi.fn(),
  order: [] as string[],
  rpc: vi.fn(),
  rpcResult: null as unknown,
  rpcThrows: false,
  updateUserById: vi.fn(),
  updateResult: null as unknown,
  updateThrows: false,
  headers: {} as Record<string, string>,
  afterQueue: [] as Array<() => unknown>,
  afterThrows: false,
  signInWithOAuth: vi.fn(),
  oauthResult: null as unknown,
  oauthThrows: false,
}));

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => fake.headers[name.toLowerCase()] ?? null,
  }),
  cookies: async () => ({ set: vi.fn(), delete: vi.fn() }),
}));
vi.mock("next/server", () => ({
  after: (callback: () => unknown) => {
    if (fake.afterThrows)
      throw new Error("`after` was called outside a request");
    fake.afterQueue.push(callback);
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    fake.order.push("redirect");
    throw new RedirectError(url);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signInWithOAuth: async (...args: unknown[]) => {
        fake.signInWithOAuth(...args);
        if (fake.oauthThrows) throw new Error("network down");
        return fake.oauthResult;
      },
      signUp: (...args: unknown[]) => {
        fake.order.push("auth");
        fake.signUp(...args);
        return Promise.resolve(fake.signUpResult);
      },
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (fake.rpcThrows) throw new Error("SUPABASE_SECRET_KEY is not set");
    return {
      rpc: (...args: unknown[]) => {
        fake.order.push("check");
        fake.rpc(...args);
        return Promise.resolve(fake.rpcResult);
      },
      auth: {
        admin: {
          updateUserById: (...args: unknown[]) => {
            fake.order.push("clear");
            fake.updateUserById(...args);
            if (fake.updateThrows) return Promise.reject(new Error("boom"));
            return Promise.resolve(fake.updateResult);
          },
        },
      },
    };
  },
}));
vi.mock("@/lib/analytics/track", () => ({
  trackAfterResponse: (...args: unknown[]) => {
    fake.order.push("track");
    fake.trackAfterResponse(...args);
  },
}));

let signUp: typeof import("./actions").signUp;
let signInWithGoogle: typeof import("./actions").signInWithGoogle;

/** Runs what was handed to `after`, as the server does once the response is sent. */
async function flushAfter() {
  for (const callback of fake.afterQueue.splice(0)) await callback();
}

function form() {
  const fd = new FormData();
  fd.set("displayName", "Sam");
  fd.set("email", "sam@example.com");
  fd.set("password", "a-good-long-password-1");
  return fd;
}

const created = (overrides: Partial<SignUpResult["data"]> = {}) =>
  ({
    data: {
      user: { id: "user-1", identities: [{ id: "identity-1" }] },
      session: null,
      ...overrides,
    },
    error: null,
  }) satisfies SignUpResult;

beforeEach(async () => {
  // A fresh module per test gives each one its own sign-up rate limiter.
  vi.resetModules();
  ({ signUp, signInWithGoogle } = await import("./actions"));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fake.rpc.mockClear();
  fake.rpcResult = { data: true, error: null };
  fake.rpcThrows = false;
  fake.updateUserById.mockClear();
  fake.updateResult = { data: {}, error: null };
  fake.updateThrows = false;
  fake.signUpResult = created();
  fake.signUp.mockClear();
  fake.trackAfterResponse.mockClear();
  fake.order = [];
  fake.headers = { origin: "https://astrapair.test" };
  fake.afterQueue = [];
  fake.afterThrows = false;
  fake.signInWithOAuth.mockClear();
  fake.oauthResult = {
    data: { url: "https://accounts.google.test/o/oauth2/v2/auth?state=s1" },
    error: null,
  };
  fake.oauthThrows = false;
});

describe("signUp analytics", () => {
  it("tracks a registration before redirecting to check your email", async () => {
    await expect(signUp({}, form())).rejects.toMatchObject({
      url: "/check-email",
    });
    expect(fake.trackAfterResponse).toHaveBeenCalledTimes(1);
    expect(fake.trackAfterResponse).toHaveBeenCalledWith(
      "registration",
      "user-1",
    );
    expect(fake.order).toEqual(["auth", "track", "redirect"]);
  });

  it("tracks a registration before redirecting when a session starts at once", async () => {
    fake.signUpResult = created({ session: { access_token: "x" } });
    await expect(signUp({}, form())).rejects.toBeInstanceOf(RedirectError);
    expect(fake.trackAfterResponse).toHaveBeenCalledWith(
      "registration",
      "user-1",
    );
    expect(fake.order).toEqual(["auth", "track", "redirect"]);
  });

  it("does not track when Supabase returns an error", async () => {
    fake.signUpResult = {
      data: { user: null, session: null },
      error: { code: "weak_password", status: 422 },
    };
    await signUp({}, form());
    expect(fake.trackAfterResponse).not.toHaveBeenCalled();
  });

  it("does not track when no user id is available", async () => {
    fake.signUpResult = created({ user: null });
    await expect(signUp({}, form())).rejects.toBeInstanceOf(RedirectError);
    expect(fake.trackAfterResponse).not.toHaveBeenCalled();
  });

  it("does not track the disguised response for an email that already exists", async () => {
    fake.signUpResult = created({ user: { id: "user-9", identities: [] } });
    await expect(signUp({}, form())).rejects.toBeInstanceOf(RedirectError);
    expect(fake.trackAfterResponse).not.toHaveBeenCalled();
  });

  it("does not track when the form is invalid", async () => {
    await signUp({}, new FormData());
    expect(fake.signUp).not.toHaveBeenCalled();
    expect(fake.trackAfterResponse).not.toHaveBeenCalled();
  });
});

const CODE_MESSAGE = "That invite code isn't valid or has been used up.";

function metadata() {
  const options = fake.signUp.mock.calls[0][0].options;
  return options.data as Record<string, unknown>;
}

describe("signUp beta gate", () => {
  it("sends no beta_code with the gate off, even if one is posted", async () => {
    vi.stubEnv("BETA_GATE", "off");
    const fd = form();
    fd.set("betaCode", "ABCD2345WXYZ");
    await expect(signUp({}, fd)).rejects.toBeInstanceOf(RedirectError);
    expect(metadata()).toEqual({ display_name: "Sam" });
  });

  it("sends no beta_code when BETA_GATE is unset", async () => {
    vi.stubEnv("BETA_GATE", undefined);
    const fd = form();
    fd.set("betaCode", "ABCD2345WXYZ");
    await expect(signUp({}, fd)).rejects.toBeInstanceOf(RedirectError);
    expect(metadata()).not.toHaveProperty("beta_code");
  });

  it("passes the canonical code as beta_code whatever way it was typed", async () => {
    vi.stubEnv("BETA_GATE", "on");
    for (const typed of [
      "abcd2345wxyz",
      "ABCD-2345-WXYZ",
      " abcd 2345 wxyz ",
    ]) {
      fake.signUp.mockClear();
      const fd = form();
      fd.set("betaCode", typed);
      await expect(signUp({}, fd)).rejects.toBeInstanceOf(RedirectError);
      expect(metadata().beta_code, typed).toBe("ABCD2345WXYZ");
    }
  });

  it("passes the trimmed code as beta_code with the gate on", async () => {
    vi.stubEnv("BETA_GATE", " ON ");
    const fd = form();
    fd.set("betaCode", "  ABCD2345WXYZ \n");
    await expect(signUp({}, fd)).rejects.toBeInstanceOf(RedirectError);
    expect(metadata()).toEqual({
      display_name: "Sam",
      beta_code: "ABCD2345WXYZ",
    });
  });

  it("still tracks the registration when the gate lets the sign-up through", async () => {
    vi.stubEnv("BETA_GATE", "on");
    const fd = form();
    fd.set("betaCode", "ABCD2345WXYZ");
    await expect(signUp({}, fd)).rejects.toBeInstanceOf(RedirectError);
    expect(fake.trackAfterResponse).toHaveBeenCalledWith(
      "registration",
      "user-1",
    );
  });

  it("asks for a code without calling Supabase when it is missing or blank", async () => {
    vi.stubEnv("BETA_GATE", "on");
    for (const blank of [undefined, "", "   "]) {
      const fd = form();
      if (blank !== undefined) fd.set("betaCode", blank);
      const state = await signUp({}, fd);
      expect(state.fieldErrors?.betaCode).toEqual(["Enter your invite code."]);
    }
    expect(fake.signUp).not.toHaveBeenCalled();
  });

  it("rejects an over-long code with the single message, without calling Supabase", async () => {
    vi.stubEnv("BETA_GATE", "on");
    const fd = form();
    fd.set("betaCode", "A".repeat(65));
    const state = await signUp({}, fd);
    expect(state.fieldErrors?.betaCode).toEqual([CODE_MESSAGE]);
    expect(fake.signUp).not.toHaveBeenCalled();
  });

  it("reports the code and other field errors together", async () => {
    vi.stubEnv("BETA_GATE", "on");
    const state = await signUp({}, new FormData());
    expect(state.fieldErrors).toHaveProperty("betaCode");
    expect(state.fieldErrors).toHaveProperty("email");
    expect(fake.signUp).not.toHaveBeenCalled();
  });

  it("maps the hook's rejection to the invite code field error", async () => {
    vi.stubEnv("BETA_GATE", "on");
    fake.signUpResult = {
      data: { user: null, session: null },
      error: { status: 403, message: "beta_code_invalid" },
    };
    const fd = form();
    fd.set("betaCode", "ABCD2345WXYZ");
    const state = await signUp({}, fd);
    expect(state.fieldErrors).toEqual({ betaCode: [CODE_MESSAGE] });
    expect(state.error).toBeUndefined();
    expect(fake.trackAfterResponse).not.toHaveBeenCalled();
  });

  it("echoes the code back with the gate on and drops it with the gate off", async () => {
    vi.stubEnv("BETA_GATE", "on");
    fake.signUpResult = {
      data: { user: null, session: null },
      error: { status: 403, message: "beta_code_invalid" },
    };
    const fd = form();
    fd.set("betaCode", "ABCD2345WXYZ");
    const on = await signUp({}, fd);
    expect(on.values).toMatchObject({ betaCode: "ABCD2345WXYZ" });
    expect(on.values).not.toHaveProperty("password");

    vi.stubEnv("BETA_GATE", "off");
    const off = await signUp({}, fd);
    expect(off.values).not.toHaveProperty("betaCode");
  });

  it("does not show an invite code message when the gate is off", async () => {
    vi.stubEnv("BETA_GATE", "off");
    fake.signUpResult = {
      data: { user: null, session: null },
      error: { status: 403, message: "beta_code_invalid" },
    };
    const state = await signUp({}, form());
    expect(state.fieldErrors).toBeUndefined();
    expect(state.error).toBe(
      "We couldn't create your account. Please try again.",
    );
  });
});

describe("signUp beta code check", () => {
  const withCode = () => {
    vi.stubEnv("BETA_GATE", "on");
    const fd = form();
    fd.set("betaCode", "abcd-2345-wxyz");
    return fd;
  };

  it("checks the code, canonical and read-only, before calling auth", async () => {
    await expect(signUp({}, withCode())).rejects.toBeInstanceOf(RedirectError);
    expect(fake.rpc).toHaveBeenCalledWith("check_beta_code", {
      p_code: "ABCD2345WXYZ",
    });
    expect(fake.order.slice(0, 2)).toEqual(["check", "auth"]);
  });

  it("does not call auth when the code is not usable", async () => {
    fake.rpcResult = { data: false, error: null };
    const state = await signUp({}, withCode());
    expect(state.fieldErrors).toEqual({ betaCode: [CODE_MESSAGE] });
    expect(fake.signUp).not.toHaveBeenCalled();
    expect(fake.trackAfterResponse).not.toHaveBeenCalled();
  });

  it("does not call auth when the check fails or cannot run", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fake.rpcResult = { data: null, error: { code: "42883" } };
    expect((await signUp({}, withCode())).fieldErrors).toEqual({
      betaCode: [CODE_MESSAGE],
    });
    fake.rpcResult = { data: null, error: null };
    expect((await signUp({}, withCode())).fieldErrors).toEqual({
      betaCode: [CODE_MESSAGE],
    });
    fake.rpcThrows = true;
    expect((await signUp({}, withCode())).fieldErrors).toEqual({
      betaCode: [CODE_MESSAGE],
    });
    expect(fake.signUp).not.toHaveBeenCalled();
  });

  it("answers the same for a bad code whether or not the email is registered", async () => {
    fake.rpcResult = { data: false, error: null };
    fake.signUpResult = created({ user: { id: "user-9", identities: [] } });
    const registered = await signUp({}, withCode());
    fake.signUpResult = created();
    const fresh = await signUp({}, withCode());
    expect(registered.fieldErrors).toEqual(fresh.fieldErrors);
    expect(fake.signUp).not.toHaveBeenCalled();
  });

  it("does not check anything with the gate off", async () => {
    vi.stubEnv("BETA_GATE", "off");
    const fd = form();
    fd.set("betaCode", "ABCD2345WXYZ");
    await expect(signUp({}, fd)).rejects.toBeInstanceOf(RedirectError);
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(fake.updateUserById).not.toHaveBeenCalled();
  });
});

describe("signUp clears the code from user metadata", () => {
  const withCode = () => {
    vi.stubEnv("BETA_GATE", "on");
    const fd = form();
    fd.set("betaCode", "ABCD2345WXYZ");
    return fd;
  };

  it("clears it after the response, not before redirecting", async () => {
    await expect(signUp({}, withCode())).rejects.toBeInstanceOf(RedirectError);
    expect(fake.updateUserById).not.toHaveBeenCalled();
    expect(fake.order).toEqual(["check", "auth", "track", "redirect"]);

    await flushAfter();
    expect(fake.updateUserById).toHaveBeenCalledTimes(1);
    expect(fake.updateUserById).toHaveBeenCalledWith("user-1", {
      user_metadata: { beta_code: null },
    });
    expect(fake.order).toEqual(["check", "auth", "track", "redirect", "clear"]);
  });

  it("clears it after the response when a session starts at once", async () => {
    fake.signUpResult = created({ session: { access_token: "x" } });
    await expect(signUp({}, withCode())).rejects.toMatchObject({
      url: "/onboarding",
    });
    expect(fake.updateUserById).not.toHaveBeenCalled();
    await flushAfter();
    expect(fake.updateUserById).toHaveBeenCalledWith("user-1", {
      user_metadata: { beta_code: null },
    });
  });

  it("runs the clean-up directly, without waiting, when `after` is unavailable", async () => {
    fake.afterThrows = true;
    await expect(signUp({}, withCode())).rejects.toBeInstanceOf(RedirectError);
    expect(fake.updateUserById).toHaveBeenCalledWith("user-1", {
      user_metadata: { beta_code: null },
    });
    expect(fake.afterQueue).toHaveLength(0);
  });

  it("does not clear it when sign-up fails or for the disguised existing-email response", async () => {
    fake.signUpResult = {
      data: { user: null, session: null },
      error: { status: 403, message: "beta_code_invalid" },
    };
    await signUp({}, withCode());
    fake.signUpResult = created({ user: { id: "user-9", identities: [] } });
    await expect(signUp({}, withCode())).rejects.toBeInstanceOf(RedirectError);
    fake.signUpResult = created({ user: null });
    await expect(signUp({}, withCode())).rejects.toBeInstanceOf(RedirectError);
    expect(fake.updateUserById).not.toHaveBeenCalled();
  });

  it("does not touch metadata with the gate off", async () => {
    vi.stubEnv("BETA_GATE", "off");
    await expect(signUp({}, form())).rejects.toBeInstanceOf(RedirectError);
    expect(fake.updateUserById).not.toHaveBeenCalled();
  });

  it("still signs up when clearing fails, and logs only a fixed message and code", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.updateResult = {
      data: null,
      error: { code: "unexpected_failure", message: "ABCD2345WXYZ leaked" },
    };
    await expect(signUp({}, withCode())).rejects.toMatchObject({
      url: "/check-email",
    });
    await flushAfter();
    fake.updateThrows = true;
    await expect(signUp({}, withCode())).rejects.toMatchObject({
      url: "/check-email",
    });
    await flushAfter();
    expect(log).toHaveBeenCalledWith(
      "beta_code_cleanup_failed",
      "unexpected_failure",
    );
    expect(log).toHaveBeenCalledWith("beta_code_cleanup_failed", "exception");
    expect(JSON.stringify(log.mock.calls)).not.toContain("ABCD2345WXYZ");
  });
});

describe("signUp beta code check logging", () => {
  const withCode = () => {
    vi.stubEnv("BETA_GATE", "on");
    const fd = form();
    fd.set("betaCode", "ABCD2345WXYZ");
    return fd;
  };

  it("still fails closed and logs a fixed message with the error code only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.rpcResult = {
      data: null,
      error: { code: "42883", message: "ABCD2345WXYZ sam@example.com" },
    };
    expect((await signUp({}, withCode())).fieldErrors).toEqual({
      betaCode: [CODE_MESSAGE],
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("beta_code_check_failed", "42883");
    expect(fake.signUp).not.toHaveBeenCalled();
  });

  it("logs a fixed word when the error has no code", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.rpcResult = { data: null, error: { message: "sam@example.com" } };
    await signUp({}, withCode());
    expect(log.mock.calls).toEqual([["beta_code_check_failed", "unknown"]]);
  });

  it("logs a missing secret key or other exception without the message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.rpcThrows = true;
    expect((await signUp({}, withCode())).fieldErrors).toEqual({
      betaCode: [CODE_MESSAGE],
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("beta_code_check_failed", "exception");
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain("SUPABASE_SECRET_KEY");
    expect(logged).not.toContain("ABCD2345WXYZ");
    expect(logged).not.toContain("sam@example.com");
  });

  it("logs nothing for an ordinary unusable code or a usable one", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.rpcResult = { data: false, error: null };
    await signUp({}, withCode());
    fake.rpcResult = { data: true, error: null };
    await expect(signUp({}, withCode())).rejects.toBeInstanceOf(RedirectError);
    expect(log).not.toHaveBeenCalled();
  });
});

describe("auth rate limit", () => {
  const RATE_MESSAGE =
    "Too many attempts. Please wait a few minutes and try again.";

  const fromIp = (forwarded: string | null, real?: string) => {
    fake.headers = { origin: "https://astrapair.test" };
    if (forwarded !== null) fake.headers["x-forwarded-for"] = forwarded;
    if (real) fake.headers["x-real-ip"] = real;
  };

  const googleForm = () => new FormData();

  it("allows ten sign-ups from one address and blocks the eleventh", async () => {
    fromIp("203.0.113.7");
    for (let i = 0; i < 10; i += 1) {
      await expect(signUp({}, form())).rejects.toBeInstanceOf(RedirectError);
    }
    expect(fake.signUp).toHaveBeenCalledTimes(10);

    fake.signUp.mockClear();
    const state = await signUp({}, form());
    expect(state.error).toBe(RATE_MESSAGE);
    expect(state.values).toEqual({
      displayName: "Sam",
      email: "sam@example.com",
    });
    expect(fake.signUp).not.toHaveBeenCalled();
  });

  it("checks the limit before the invite code pre-check", async () => {
    vi.stubEnv("BETA_GATE", "on");
    fromIp("203.0.113.8");
    const withCode = () => {
      const fd = form();
      fd.set("betaCode", "ABCD2345WXYZ");
      return fd;
    };
    for (let i = 0; i < 10; i += 1) {
      await expect(signUp({}, withCode())).rejects.toBeInstanceOf(
        RedirectError,
      );
    }
    expect(fake.rpc).toHaveBeenCalledTimes(10);

    fake.rpc.mockClear();
    fake.order = [];
    const state = await signUp({}, withCode());
    expect(state.error).toBe(RATE_MESSAGE);
    expect(state.fieldErrors).toBeUndefined();
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(fake.order).toEqual([]);
  });

  it("does not count forms that fail validation", async () => {
    fromIp("203.0.113.9");
    for (let i = 0; i < 25; i += 1) await signUp({}, new FormData());
    await expect(signUp({}, form())).rejects.toBeInstanceOf(RedirectError);
  });

  it("counts addresses separately and uses the first x-forwarded-for entry", async () => {
    fromIp("198.51.100.1, 10.0.0.1");
    for (let i = 0; i < 10; i += 1) {
      await expect(signUp({}, form())).rejects.toBeInstanceOf(RedirectError);
    }
    // A different proxy chain behind the same client address is the same client.
    fromIp("198.51.100.1, 10.0.0.99");
    expect((await signUp({}, form())).error).toBe(RATE_MESSAGE);
    // Another client is unaffected.
    fromIp("198.51.100.2, 10.0.0.1");
    await expect(signUp({}, form())).rejects.toBeInstanceOf(RedirectError);
  });

  it("falls back to x-real-ip, then to one shared bucket", async () => {
    fromIp(null, "192.0.2.5");
    for (let i = 0; i < 10; i += 1) {
      await expect(signUp({}, form())).rejects.toBeInstanceOf(RedirectError);
    }
    expect((await signUp({}, form())).error).toBe(RATE_MESSAGE);
    fromIp(null, "192.0.2.6");
    await expect(signUp({}, form())).rejects.toBeInstanceOf(RedirectError);

    fromIp(null);
    for (let i = 0; i < 10; i += 1) {
      await expect(signUp({}, form())).rejects.toBeInstanceOf(RedirectError);
    }
    expect((await signUp({}, form())).error).toBe(RATE_MESSAGE);
  });

  it("keys on at most the first 64 characters of the address", async () => {
    const long = "x".repeat(64);
    fromIp(`${long}a`);
    for (let i = 0; i < 10; i += 1) {
      await expect(signUp({}, form())).rejects.toBeInstanceOf(RedirectError);
    }
    fromIp(`${long}b`);
    expect((await signUp({}, form())).error).toBe(RATE_MESSAGE);
  });

  it("lets the address back in after ten minutes", async () => {
    // The limiter reads the clock it was created with, so fake it before loading.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.resetModules();
    ({ signUp } = await import("./actions"));
    try {
      fromIp("203.0.113.10");
      for (let i = 0; i < 10; i += 1) {
        await expect(signUp({}, form())).rejects.toBeInstanceOf(RedirectError);
      }
      expect((await signUp({}, form())).error).toBe(RATE_MESSAGE);
      vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1000);
      await expect(signUp({}, form())).rejects.toBeInstanceOf(RedirectError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is shared with Google sign-in, which redirects with an allowlisted code", async () => {
    fromIp("203.0.113.11");
    for (let i = 0; i < 5; i += 1) {
      await expect(signUp({}, form())).rejects.toBeInstanceOf(RedirectError);
    }
    for (let i = 0; i < 5; i += 1) {
      await expect(signInWithGoogle(googleForm())).rejects.toMatchObject({
        url: expect.stringContaining("accounts.google.test"),
      });
    }
    fake.signInWithOAuth.mockClear();
    await expect(signInWithGoogle(googleForm())).rejects.toMatchObject({
      url: "/login?error=oauth_rate_limited",
    });
    expect(fake.signInWithOAuth).not.toHaveBeenCalled();
    expect((await signUp({}, form())).error).toBe(RATE_MESSAGE);
  });

  it("starts each test with a clean limiter", async () => {
    // Same address as the test above: the module is reloaded for every test.
    fromIp("203.0.113.11");
    await expect(signUp({}, form())).rejects.toBeInstanceOf(RedirectError);
  });
});

describe("signInWithGoogle", () => {
  const googleForm = (next?: string) => {
    const fd = new FormData();
    if (next !== undefined) fd.set("next", next);
    return fd;
  };
  const GOOGLE_URL = "https://accounts.google.test/o/oauth2/v2/auth?state=s1";
  const redirectTo = () =>
    fake.signInWithOAuth.mock.calls[0][0].options.redirectTo as string;

  it("starts the Google flow and redirects to the URL Supabase returns", async () => {
    await expect(signInWithGoogle(googleForm("/chart"))).rejects.toMatchObject({
      url: GOOGLE_URL,
    });
    expect(fake.signInWithOAuth).toHaveBeenCalledTimes(1);
    expect(fake.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo:
          "https://astrapair.test/auth/callback?next=%2Fchart&flow=google",
      },
    });
  });

  it("falls back to the dashboard when no next is posted", async () => {
    await expect(signInWithGoogle(googleForm())).rejects.toBeInstanceOf(
      RedirectError,
    );
    expect(redirectTo()).toBe(
      "https://astrapair.test/auth/callback?next=%2Fdashboard&flow=google",
    );
  });

  it.each([
    "//evil.example",
    "https://evil.example/x",
    "/\\evil.example",
    "javascript:alert(1)",
    "dashboard",
    "",
  ])("ignores the unsafe next %j", async (next) => {
    await expect(signInWithGoogle(googleForm(next))).rejects.toBeInstanceOf(
      RedirectError,
    );
    expect(redirectTo()).toBe(
      "https://astrapair.test/auth/callback?next=%2Fdashboard&flow=google",
    );
  });

  it("encodes a next path that has a query string", async () => {
    await expect(
      signInWithGoogle(googleForm("/onboarding?next=%2Finvite%2Fabc")),
    ).rejects.toBeInstanceOf(RedirectError);
    expect(redirectTo()).toBe(
      `https://astrapair.test/auth/callback?next=${encodeURIComponent("/onboarding?next=%2Finvite%2Fabc")}&flow=google`,
    );
  });

  it("uses the host header when there is no origin header", async () => {
    fake.headers = { host: "app.astrapair.test" };
    await expect(signInWithGoogle(googleForm())).rejects.toBeInstanceOf(
      RedirectError,
    );
    expect(redirectTo()).toBe(
      "https://app.astrapair.test/auth/callback?next=%2Fdashboard&flow=google",
    );

    fake.signInWithOAuth.mockClear();
    fake.headers = { host: "localhost:3000" };
    await expect(signInWithGoogle(googleForm())).rejects.toBeInstanceOf(
      RedirectError,
    );
    expect(redirectTo()).toBe(
      "http://localhost:3000/auth/callback?next=%2Fdashboard&flow=google",
    );
  });

  it("does not start the flow when the request has no origin or host", async () => {
    fake.headers = {};
    await expect(signInWithGoogle(googleForm())).rejects.toMatchObject({
      url: "/login?error=oauth_unavailable",
    });
    expect(fake.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("redirects to oauth_unavailable on an error, a missing URL or an exception", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const unavailable = { url: "/login?error=oauth_unavailable" };

    fake.oauthResult = { data: { url: null }, error: { status: 500 } };
    await expect(signInWithGoogle(googleForm())).rejects.toMatchObject(
      unavailable,
    );

    fake.oauthResult = { data: { url: GOOGLE_URL }, error: { status: 500 } };
    await expect(signInWithGoogle(googleForm())).rejects.toMatchObject(
      unavailable,
    );

    fake.oauthResult = { data: { url: null }, error: null };
    await expect(signInWithGoogle(googleForm())).rejects.toMatchObject(
      unavailable,
    );

    fake.oauthResult = { data: null, error: null };
    await expect(signInWithGoogle(googleForm())).rejects.toMatchObject(
      unavailable,
    );

    fake.oauthThrows = true;
    await expect(signInWithGoogle(googleForm())).rejects.toMatchObject(
      unavailable,
    );
    expect(log).not.toHaveBeenCalled();
  });

  it("does not call Supabase when Google sign-in is turned off", async () => {
    vi.stubEnv("GOOGLE_AUTH", "off");
    await expect(signInWithGoogle(googleForm())).rejects.toMatchObject({
      url: "/login?error=oauth_unavailable",
    });
    expect(fake.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("never logs the URL, the state or the destination", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (method) => vi.spyOn(console, method).mockImplementation(() => {}),
    );
    await expect(signInWithGoogle(googleForm("/chart"))).rejects.toBeInstanceOf(
      RedirectError,
    );
    fake.oauthThrows = true;
    await expect(signInWithGoogle(googleForm("/chart"))).rejects.toBeInstanceOf(
      RedirectError,
    );
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
