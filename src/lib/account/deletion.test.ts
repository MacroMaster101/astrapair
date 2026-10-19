import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const fake = vi.hoisted(() => ({
  order: [] as string[],
  getUserId: vi.fn(),
  getUser: vi.fn(),
  getClaims: vi.fn(),
  requestSignOut: vi.fn(),
  verifyClientFactory: vi.fn(),
  signInWithPassword: vi.fn(),
  verifySignOut: vi.fn(),
  deleteUser: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  scrub: vi.fn(),
  from: vi.fn(),
  createAdminClient: vi.fn(),
  trackEvent: vi.fn(),
  cookieDelete: vi.fn(),
  cookieSet: vi.fn(),
  requestCreateClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getUserId: fake.getUserId }));
vi.mock("@/lib/env", () => ({
  getPublicEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.test",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: fake.verifyClientFactory,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: fake.requestCreateClient,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: fake.createAdminClient,
}));
vi.mock("@/lib/analytics/track", () => ({ trackEvent: fake.trackEvent }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ delete: fake.cookieDelete, set: fake.cookieSet }),
}));

import { userRef } from "@/lib/analytics/events";

const SALT = "a-long-enough-test-salt";
const EMAIL = "session-user@example.com";
const PASSWORD = "correct horse battery staple";

let counter = 0;
let userId: string;
let deletion: typeof import("./deletion");

function ok<T>(value: T) {
  return Promise.resolve(value);
}

beforeEach(async () => {
  vi.resetModules();
  counter += 1;
  userId = `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
  fake.order = [];
  for (const mock of Object.values(fake)) {
    if (typeof mock === "function" && "mockReset" in mock) mock.mockReset();
  }

  fake.getUserId.mockImplementation(() => ok(userId));
  fake.getUser.mockImplementation(() =>
    ok({ data: { user: { id: userId, email: EMAIL } }, error: null }),
  );
  fake.getClaims.mockImplementation(() => ok({ data: null, error: null }));
  fake.requestSignOut.mockImplementation(() => {
    fake.order.push("request-signout");
    return ok({ error: null });
  });
  fake.requestCreateClient.mockImplementation(() =>
    ok({
      auth: {
        getUser: fake.getUser,
        getClaims: fake.getClaims,
        signOut: fake.requestSignOut,
      },
    }),
  );

  fake.signInWithPassword.mockImplementation(() => {
    fake.order.push("verify");
    return ok({
      data: { user: { id: userId }, session: { access_token: "t" } },
      error: null,
    });
  });
  fake.verifySignOut.mockImplementation(() => ok({ error: null }));
  fake.verifyClientFactory.mockImplementation(() => ({
    auth: {
      signInWithPassword: fake.signInWithPassword,
      signOut: fake.verifySignOut,
    },
  }));

  fake.deleteUser.mockImplementation(() => {
    fake.order.push("delete");
    return ok({ data: { user: null }, error: null });
  });
  fake.insert.mockImplementation(() => {
    fake.order.push("audit");
    return ok({ error: null });
  });
  fake.scrub.mockImplementation(() => {
    fake.order.push("scrub");
    return ok({ error: null });
  });
  // update(values).eq(a, x).eq(b, y): the filters are recorded, then it runs.
  fake.update.mockImplementation((values: unknown) => {
    const filters: [string, unknown][] = [];
    const chain = {
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return filters.length === 2 ? fake.scrub(values, filters) : chain;
      },
    };
    return chain;
  });
  fake.from.mockImplementation(() => ({
    insert: fake.insert,
    update: fake.update,
  }));
  fake.createAdminClient.mockImplementation(() => ({
    auth: { admin: { deleteUser: fake.deleteUser } },
    from: fake.from,
  }));
  fake.trackEvent.mockImplementation(() => {
    fake.order.push("track");
    return ok(undefined);
  });
  fake.cookieDelete.mockImplementation(() => {
    fake.order.push("cookie");
  });

  vi.stubEnv("ANALYTICS_SALT", SALT);
  deletion = await import("./deletion");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const attempt = (
  overrides: { confirmation?: string; password?: string } = {},
) =>
  deletion.deleteOwnAccount({
    confirmation: "DELETE",
    password: PASSWORD,
    ...overrides,
  });

function expectNothingTouched() {
  expect(fake.getUserId).not.toHaveBeenCalled();
  expect(fake.requestCreateClient).not.toHaveBeenCalled();
  expect(fake.verifyClientFactory).not.toHaveBeenCalled();
  expect(fake.createAdminClient).not.toHaveBeenCalled();
  expect(fake.deleteUser).not.toHaveBeenCalled();
  expect(fake.trackEvent).not.toHaveBeenCalled();
  expect(fake.cookieDelete).not.toHaveBeenCalled();
}

describe("deleteOwnAccount confirmation", () => {
  it.each(["", "delete", "Delete", "DELETE ME", "DELET", "DELETEDELETE"])(
    "rejects %j with no network or cookie calls at all",
    async (confirmation) => {
      expect(await attempt({ confirmation })).toEqual({
        ok: false,
        code: "bad_confirmation",
      });
      expectNothingTouched();
    },
  );

  it("accepts DELETE after trimming whitespace", async () => {
    expect(await attempt({ confirmation: "  DELETE\n" })).toEqual({ ok: true });
    expect(fake.deleteUser).toHaveBeenCalledTimes(1);
  });

  it("does not use up rate limit attempts", async () => {
    for (let i = 0; i < 10; i += 1) {
      await attempt({ confirmation: "nope" });
    }
    expect(await attempt()).toEqual({ ok: true });
  });
});

describe("deleteOwnAccount session", () => {
  it("returns not_signed_in when there is no session user id", async () => {
    fake.getUserId.mockImplementation(() => ok(null));
    expect(await attempt()).toEqual({ ok: false, code: "not_signed_in" });
    expect(fake.verifyClientFactory).not.toHaveBeenCalled();
    expect(fake.deleteUser).not.toHaveBeenCalled();
  });

  it("returns not_signed_in when the server cannot return the user", async () => {
    fake.getUser.mockImplementation(() =>
      ok({ data: { user: null }, error: { status: 401 } }),
    );
    expect(await attempt()).toEqual({ ok: false, code: "not_signed_in" });
    expect(fake.verifyClientFactory).not.toHaveBeenCalled();
    expect(fake.deleteUser).not.toHaveBeenCalled();
  });

  it("returns not_signed_in when the user differs from the session claims", async () => {
    fake.getUser.mockImplementation(() =>
      ok({ data: { user: { id: "someone-else", email: EMAIL } }, error: null }),
    );
    expect(await attempt()).toEqual({ ok: false, code: "not_signed_in" });
    expect(fake.verifyClientFactory).not.toHaveBeenCalled();
    expect(fake.deleteUser).not.toHaveBeenCalled();
  });

  it("does not verify a password when the account has no email", async () => {
    fake.getUser.mockImplementation(() =>
      ok({ data: { user: { id: userId, email: undefined } }, error: null }),
    );
    expect(await attempt()).toEqual({ ok: false, code: "bad_password" });
    expect(fake.signInWithPassword).not.toHaveBeenCalled();
    expect(fake.deleteUser).not.toHaveBeenCalled();
  });
});

describe("deleteOwnAccount rate limit", () => {
  it("allows five attempts an hour and blocks the sixth before verifying", async () => {
    fake.signInWithPassword.mockImplementation(() =>
      ok({
        data: { session: null },
        error: { status: 400, code: "invalid_credentials", message: "bad" },
      }),
    );
    for (let i = 0; i < 5; i += 1) {
      expect(await attempt()).toEqual({ ok: false, code: "bad_password" });
    }
    expect(fake.signInWithPassword).toHaveBeenCalledTimes(5);

    fake.signInWithPassword.mockClear();
    fake.verifyClientFactory.mockClear();
    expect(await attempt()).toEqual({ ok: false, code: "rate_limited" });
    expect(fake.signInWithPassword).not.toHaveBeenCalled();
    expect(fake.verifyClientFactory).not.toHaveBeenCalled();
    expect(fake.deleteUser).not.toHaveBeenCalled();
  });

  it("limits each user separately", async () => {
    fake.signInWithPassword.mockImplementation(() =>
      ok({
        data: { session: null },
        error: { status: 400, code: "invalid_credentials", message: "bad" },
      }),
    );
    for (let i = 0; i < 6; i += 1) await attempt();
    const otherUser = "99999999-0000-4000-8000-000000000001";
    fake.getUserId.mockImplementation(() => ok(otherUser));
    fake.getUser.mockImplementation(() =>
      ok({ data: { user: { id: otherUser, email: EMAIL } }, error: null }),
    );
    expect(await attempt()).toEqual({ ok: false, code: "bad_password" });
  });
});

describe("deleteOwnAccount password verification", () => {
  it("uses the email from the session user, never anything else", async () => {
    await attempt();
    expect(fake.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(fake.signInWithPassword).toHaveBeenCalledWith({
      email: EMAIL,
      password: PASSWORD,
    });
  });

  it("verifies on a fresh client that cannot touch the request cookies", async () => {
    await attempt();
    expect(fake.verifyClientFactory).toHaveBeenCalledTimes(1);
    const [url, key, options] = fake.verifyClientFactory.mock.calls[0];
    expect(url).toBe("https://project.supabase.test");
    expect(key).toBe("sb_publishable_test");
    expect(options).toEqual({
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect(options).not.toHaveProperty("cookies");
    expect(options.auth).not.toHaveProperty("storage");
    // Only the delete-account clean-up (after success) may touch cookies.
    expect(fake.cookieSet).not.toHaveBeenCalled();
  });

  it("discards the verification session without leaving it live", async () => {
    await attempt();
    expect(fake.verifySignOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("returns bad_password and deletes nothing when the password is wrong", async () => {
    fake.signInWithPassword.mockImplementation(() =>
      ok({
        data: { session: null },
        error: {
          status: 400,
          code: "invalid_credentials",
          message: "Invalid login",
        },
      }),
    );
    expect(await attempt()).toEqual({ ok: false, code: "bad_password" });
    expect(fake.createAdminClient).not.toHaveBeenCalled();
    expect(fake.deleteUser).not.toHaveBeenCalled();
    expect(fake.insert).not.toHaveBeenCalled();
    expect(fake.trackEvent).not.toHaveBeenCalled();
    expect(fake.requestSignOut).not.toHaveBeenCalled();
    expect(fake.cookieDelete).not.toHaveBeenCalled();
  });

  it("treats a verification that returns no session as a wrong password", async () => {
    fake.signInWithPassword.mockImplementation(() =>
      ok({ data: { session: null }, error: null }),
    );
    expect(await attempt()).toEqual({ ok: false, code: "bad_password" });
    expect(fake.deleteUser).not.toHaveBeenCalled();
  });

  it("reports a thrown verification as unavailable, not a wrong password, and logs only a code", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.signInWithPassword.mockImplementation(() =>
      Promise.reject(new Error("network down for session-user@example.com")),
    );
    expect(await attempt()).toEqual({
      ok: false,
      code: "verify_unavailable",
    });
    expect(fake.deleteUser).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledWith("Account deletion failed", {
      stage: "verify",
      code: "exception",
    });
    expect(JSON.stringify(logged.mock.calls)).not.toContain("example.com");
  });

  it("refuses a verification session that belongs to another user", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.signInWithPassword.mockImplementation(() =>
      ok({
        data: {
          user: { id: "99999999-0000-4000-8000-000000000002" },
          session: { access_token: "t" },
        },
        error: null,
      }),
    );
    expect(await attempt()).toEqual({ ok: false, code: "bad_password" });
    expect(fake.verifySignOut).toHaveBeenCalledWith({ scope: "local" });
    expect(fake.deleteUser).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledWith("Account deletion failed", {
      stage: "verify",
      code: "user_mismatch",
    });
  });

  it("refuses a verification session with no user", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fake.signInWithPassword.mockImplementation(() =>
      ok({ data: { session: { access_token: "t" } }, error: null }),
    );
    expect(await attempt()).toEqual({ ok: false, code: "bad_password" });
    expect(fake.deleteUser).not.toHaveBeenCalled();
  });

  it("reports a check that could not be made, not a wrong password, for 429, 5xx and network failures", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const status of [429, 500, 503, 0]) {
      logged.mockClear();
      fake.signInWithPassword.mockImplementation(() =>
        ok({
          data: { user: null, session: null },
          error: {
            status,
            message: "secret detail for session-user@example.com",
          },
        }),
      );
      expect(await attempt({ password: "x" })).toEqual({
        ok: false,
        code: "verify_unavailable",
      });
      expect(fake.deleteUser).not.toHaveBeenCalled();
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged).toHaveBeenCalledWith("Account deletion failed", {
        stage: "verify",
        code: String(status),
      });
      expect(JSON.stringify(logged.mock.calls)).not.toContain("secret");
    }
  });

  it("reports an error with no status and a code that is not about the credentials as unavailable, and logs the code", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.signInWithPassword.mockImplementation(() =>
      ok({
        data: { user: null, session: null },
        error: {
          code: "unexpected_failure",
          message: "secret detail for session-user@example.com",
        },
      }),
    );
    expect(await attempt({ password: "hunter2-secret" })).toEqual({
      ok: false,
      code: "verify_unavailable",
    });
    expect(fake.deleteUser).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith("Account deletion failed", {
      stage: "verify",
      code: "unexpected_failure",
    });
    const text = JSON.stringify(logged.mock.calls);
    expect(text).not.toContain("secret");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("example.com");
  });

  it("logs the code unknown when the error has no status and no code", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.signInWithPassword.mockImplementation(() =>
      ok({
        data: { user: null, session: null },
        error: { message: "Unexpected token < in JSON" },
      }),
    );
    expect(await attempt({ password: "x" })).toEqual({
      ok: false,
      code: "verify_unavailable",
    });
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith("Account deletion failed", {
      stage: "verify",
      code: "unknown",
    });
  });

  it("keeps a client error that is not about the credentials as a wrong password, with no log", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.signInWithPassword.mockImplementation(() =>
      ok({
        data: { user: null, session: null },
        error: { status: 400, code: "email_not_confirmed", message: "x" },
      }),
    );
    expect(await attempt({ password: "x" })).toEqual({
      ok: false,
      code: "bad_password",
    });
    expect(logged).not.toHaveBeenCalled();
  });

  it("treats invalid_credentials without a status as a wrong password, with no log", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.signInWithPassword.mockImplementation(() =>
      ok({
        data: { user: null, session: null },
        error: { code: "invalid_credentials", message: "x" },
      }),
    );
    expect(await attempt({ password: "x" })).toEqual({
      ok: false,
      code: "bad_password",
    });
    expect(logged).not.toHaveBeenCalled();
  });

  it("logs nothing for a plain wrong password", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.signInWithPassword.mockImplementation(() =>
      ok({
        data: { user: null, session: null },
        error: { status: 400, code: "invalid_credentials", message: "bad" },
      }),
    );
    expect(await attempt({ password: "x" })).toEqual({
      ok: false,
      code: "bad_password",
    });
    expect(logged).not.toHaveBeenCalled();
  });

  it("still deletes when discarding the verification session fails", async () => {
    fake.verifySignOut.mockImplementation(() => Promise.reject(new Error("x")));
    expect(await attempt()).toEqual({ ok: true });
    expect(fake.deleteUser).toHaveBeenCalledTimes(1);
  });
});

describe("deleteOwnAccount success", () => {
  it("deletes once, then audits, tracks, signs out and clears the invite cookie", async () => {
    expect(await attempt()).toEqual({ ok: true });

    expect(fake.deleteUser).toHaveBeenCalledTimes(1);
    expect(fake.deleteUser).toHaveBeenCalledWith(userId);
    expect(fake.order).toEqual([
      "verify",
      "delete",
      "audit",
      "scrub",
      "track",
      "request-signout",
      "cookie",
    ]);
    expect(fake.trackEvent).toHaveBeenCalledWith("account_deleted", userId);
    expect(fake.cookieDelete).toHaveBeenCalledWith("astrapair_next");
  });

  it("writes an audit row that does not contain the user id anywhere", async () => {
    await attempt();
    expect(fake.from).toHaveBeenCalledWith("audit_events");
    const row = fake.insert.mock.calls[0][0];
    expect(row).toEqual({
      actor_user_id: null,
      event_type: "account.deleted",
      resource_type: "user",
      resource_id: userRef(userId, SALT),
      metadata: {},
    });
    expect(row.resource_id).not.toBe(userId);
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(userId);
    expect(serialized).not.toContain(userId.replaceAll("-", ""));
    expect(serialized).not.toContain(EMAIL);
    expect(serialized).not.toContain(SALT);
  });

  it("leaves resource_id null when there is no valid salt", async () => {
    vi.stubEnv("ANALYTICS_SALT", "short");
    await attempt();
    const row = fake.insert.mock.calls[0][0];
    expect(row.actor_user_id).toBeNull();
    expect(row.resource_id).toBeNull();
    expect(JSON.stringify(row)).not.toContain(userId);
  });

  it("replaces the account id in user-type audit rows after a successful delete", async () => {
    await attempt();
    expect(fake.from).toHaveBeenCalledWith("audit_events");
    expect(fake.update).toHaveBeenCalledTimes(1);
    expect(fake.scrub).toHaveBeenCalledTimes(1);
    const [values, filters] = fake.scrub.mock.calls[0];
    expect(filters).toEqual([
      ["resource_type", "user"],
      ["resource_id", userId],
    ]);
    expect(values).toEqual({ resource_id: userRef(userId, SALT) });
    // The raw id is only in the filter, never in what is written.
    expect(JSON.stringify(values)).not.toContain(userId);
    expect(JSON.stringify(values)).not.toContain(userId.replaceAll("-", ""));
    expect(JSON.stringify(values)).not.toContain(SALT);
  });

  it("writes null instead of the id when there is no valid salt", async () => {
    vi.stubEnv("ANALYTICS_SALT", "short");
    await attempt();
    const [values] = fake.scrub.mock.calls[0];
    expect(values).toEqual({ resource_id: null });
  });

  it("swallows a failed or thrown audit update, logging only a code", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.scrub.mockImplementation(() =>
      ok({ error: { code: "42501", message: `denied for ${userId}` } }),
    );
    expect(await attempt()).toEqual({ ok: true });
    expect(logged).toHaveBeenCalledWith("Account deletion failed", {
      stage: "audit_scrub",
      code: "42501",
    });

    fake.scrub.mockImplementation(() => {
      throw new Error(`exploded for ${userId}`);
    });
    expect(await attempt()).toEqual({ ok: true });
    expect(logged).toHaveBeenCalledWith("Account deletion failed", {
      stage: "audit_scrub",
      code: "exception",
    });
    expect(JSON.stringify(logged.mock.calls)).not.toContain(userId);
    // The steps after it still ran.
    expect(fake.trackEvent).toHaveBeenCalled();
    expect(fake.cookieDelete).toHaveBeenCalled();
  });

  it("does not let failing best-effort steps change the result", async () => {
    fake.insert.mockImplementation(() => {
      throw new Error("audit exploded");
    });
    fake.trackEvent.mockImplementation(() => {
      throw new Error("analytics exploded");
    });
    fake.requestSignOut.mockImplementation(() => {
      throw new Error("signout exploded");
    });
    fake.cookieDelete.mockImplementation(() => {
      fake.order.push("cookie");
      throw new Error("cookie exploded");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await attempt()).toEqual({ ok: true });
    // A failure in one step does not stop the later steps.
    expect(fake.trackEvent).toHaveBeenCalled();
    expect(fake.requestSignOut).toHaveBeenCalled();
    expect(fake.order).toContain("cookie");
  });

  it("does not let a returned audit error or a rejected sign out change the result", async () => {
    fake.insert.mockImplementation(() =>
      ok({ error: { code: "42501", message: "denied" } }),
    );
    fake.requestSignOut.mockImplementation(() =>
      Promise.reject(new Error("no session")),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await attempt()).toEqual({ ok: true });
  });
});

describe("deleteOwnAccount delete failure", () => {
  it("returns error and runs nothing else when deleteUser returns an error", async () => {
    fake.deleteUser.mockImplementation(() => {
      fake.order.push("delete");
      return ok({
        data: { user: null },
        error: { code: "unexpected_failure" },
      });
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await attempt()).toEqual({ ok: false, code: "error" });

    expect(fake.insert).not.toHaveBeenCalled();
    expect(fake.update).not.toHaveBeenCalled();
    expect(fake.scrub).not.toHaveBeenCalled();
    expect(fake.trackEvent).not.toHaveBeenCalled();
    expect(fake.requestSignOut).not.toHaveBeenCalled();
    expect(fake.cookieDelete).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledWith("Account deletion failed", {
      stage: "delete",
      code: "unexpected_failure",
    });
  });

  it("returns error when deleteUser throws, and when the admin client cannot be built", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fake.deleteUser.mockImplementation(() => Promise.reject(new Error("boom")));
    expect(await attempt()).toEqual({ ok: false, code: "error" });

    fake.createAdminClient.mockImplementation(() => {
      throw new Error("SUPABASE_SECRET_KEY is not set");
    });
    expect(await attempt()).toEqual({ ok: false, code: "error" });

    expect(fake.insert).not.toHaveBeenCalled();
    expect(fake.update).not.toHaveBeenCalled();
    expect(fake.scrub).not.toHaveBeenCalled();
    expect(fake.trackEvent).not.toHaveBeenCalled();
    expect(fake.requestSignOut).not.toHaveBeenCalled();
    expect(fake.cookieDelete).not.toHaveBeenCalled();
  });

  it("never logs the password, the email or the user id", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    fake.deleteUser.mockImplementation(() =>
      ok({ data: { user: null }, error: { code: "x", message: EMAIL } }),
    );
    await attempt();
    fake.insert.mockImplementation(() => {
      throw new Error(`${EMAIL} ${PASSWORD}`);
    });
    fake.createAdminClient.mockImplementation(() => ({
      auth: { admin: { deleteUser: () => ok({ error: null }) } },
      from: fake.from,
    }));
    await attempt();

    const all = JSON.stringify([
      error.mock.calls,
      warn.mock.calls,
      log.mock.calls,
    ]);
    expect(all).not.toContain(PASSWORD);
    expect(all).not.toContain(EMAIL);
    expect(all).not.toContain(userId);
  });
});

const nowSeconds = () => Math.floor(Date.now() / 1000);

function signedInAs(
  user: Record<string, unknown>,
  claims: Record<string, unknown> | null,
) {
  fake.getUser.mockImplementation(() =>
    ok({ data: { user: { id: userId, ...user } }, error: null }),
  );
  fake.getClaims.mockImplementation(() =>
    ok({
      data: claims ? { claims: { sub: userId, ...claims } } : null,
      error: null,
    }),
  );
}

const googleOnly = {
  email: EMAIL,
  identities: [{ provider: "google" }],
  app_metadata: { provider: "google", providers: ["google"] },
};

const amrAt = (...agesInSeconds: number[]) => ({
  amr: agesInSeconds.map((age) => ({
    method: "oauth",
    timestamp: nowSeconds() - age,
  })),
});

/** Nothing was deleted and no password was checked. */
function expectNothingDeleted() {
  expect(fake.createAdminClient).not.toHaveBeenCalled();
  expect(fake.deleteUser).not.toHaveBeenCalled();
  expect(fake.insert).not.toHaveBeenCalled();
  expect(fake.trackEvent).not.toHaveBeenCalled();
  expect(fake.requestSignOut).not.toHaveBeenCalled();
  expect(fake.cookieDelete).not.toHaveBeenCalled();
}

describe("deleteOwnAccount for an account with a Google sign-in only", () => {
  it("deletes after DELETE and a recent sign-in, without asking for or checking a password", async () => {
    signedInAs(googleOnly, amrAt(60));
    expect(await attempt({ password: "" })).toEqual({ ok: true });
    expect(fake.verifyClientFactory).not.toHaveBeenCalled();
    expect(fake.signInWithPassword).not.toHaveBeenCalled();
    expect(fake.deleteUser).toHaveBeenCalledWith(userId);
    // Everything after the check is exactly as for a password account.
    expect(fake.order).toEqual([
      "delete",
      "audit",
      "scrub",
      "track",
      "request-signout",
      "cookie",
    ]);
  });

  it("ignores a password that is posted anyway", async () => {
    signedInAs(googleOnly, amrAt(60));
    expect(await attempt({ password: "anything" })).toEqual({ ok: true });
    expect(fake.verifyClientFactory).not.toHaveBeenCalled();
  });

  it("works for an account whose Google email is not on the user record", async () => {
    signedInAs({ ...googleOnly, email: undefined }, amrAt(5));
    expect(await attempt({ password: "" })).toEqual({ ok: true });
  });

  describe("with a fixed clock", () => {
    const NOW = 1_800_000_000;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW * 1000);
    });
    afterEach(() => vi.useRealTimers());

    const signedAt = (timestamp: number, method = "oauth") =>
      signedInAs(googleOnly, { amr: [{ method, timestamp }] });
    const stale = { ok: false, code: "reauth_required" };

    it.each([
      ["exactly 600 seconds old", NOW - 600, true],
      ["601 seconds old", NOW - 601, false],
      ["60 seconds ahead of the clock", NOW + 60, true],
      ["61 seconds ahead of the clock", NOW + 61, false],
      ["a day ahead", NOW + 86_400, false],
      ["a millisecond timestamp", NOW * 1000, false],
    ])("%s", async (_label, timestamp, allowed) => {
      signedAt(timestamp);
      expect(await attempt({ password: "" })).toEqual(
        allowed ? { ok: true } : stale,
      );
      if (!allowed) expectNothingDeleted();
    });

    it("does not count token_refresh entries, however new", async () => {
      signedAt(NOW, "token_refresh");
      expect(await attempt({ password: "" })).toEqual(stale);
      expectNothingDeleted();
    });

    it("is stale when a token_refresh is newer than an old sign-in", async () => {
      signedInAs(googleOnly, {
        amr: [
          { method: "oauth", timestamp: NOW - 3600 },
          { method: "token_refresh", timestamp: NOW - 5 },
        ],
      });
      expect(await attempt({ password: "" })).toEqual(stale);
      expectNothingDeleted();
    });

    it("uses the newest sign-in entry when a refresh entry is also present", async () => {
      signedInAs(googleOnly, {
        amr: [
          { method: "token_refresh", timestamp: NOW },
          { method: "oauth", timestamp: NOW - 30 },
        ],
      });
      expect(await attempt({ password: "" })).toEqual({ ok: true });
    });
  });

  it("asks for a new sign-in when the claims belong to another user", async () => {
    signedInAs(googleOnly, { ...amrAt(1), sub: "someone-else" });
    expect(await attempt({ password: "" })).toEqual({
      ok: false,
      code: "reauth_required",
    });
    expectNothingDeleted();
  });

  it("asks for a new sign-in when the newest amr entry is stale, and deletes nothing", async () => {
    signedInAs(googleOnly, amrAt(11 * 60, 3 * 60 * 60));
    expect(await attempt({ password: "" })).toEqual({
      ok: false,
      code: "reauth_required",
    });
    expectNothingDeleted();
    expect(fake.verifyClientFactory).not.toHaveBeenCalled();
  });

  it("uses the newest amr entry whatever the order of the list", async () => {
    signedInAs(googleOnly, amrAt(3 * 60 * 60, 30));
    expect(await attempt({ password: "" })).toEqual({ ok: true });
  });

  it.each([
    ["no claims at all", null],
    ["claims without amr", {}],
    ["an empty amr", { amr: [] }],
    ["amr that is not a list", { amr: "oauth" }],
    ["amr entries without a timestamp", { amr: [{ method: "oauth" }] }],
    [
      "amr timestamps that are not numbers",
      { amr: [{ method: "oauth", timestamp: String(nowSeconds()) }] },
    ],
    [
      "amr timestamps that are not finite",
      { amr: [{ method: "oauth", timestamp: Number.NaN }] },
    ],
    ["amr entries that are not objects", { amr: [null, 7, "x"] }],
  ])("asks for a new sign-in with %s", async (_label, claims) => {
    signedInAs(googleOnly, claims);
    expect(await attempt({ password: "" })).toEqual({
      ok: false,
      code: "reauth_required",
    });
    expectNothingDeleted();
  });

  it("asks for a new sign-in when the claims cannot be read", async () => {
    signedInAs(googleOnly, amrAt(1));
    fake.getClaims.mockImplementation(() =>
      ok({ data: null, error: { status: 401 } }),
    );
    expect(await attempt({ password: "" })).toEqual({
      ok: false,
      code: "reauth_required",
    });
    fake.getClaims.mockImplementation(() => Promise.reject(new Error("x")));
    expect(await attempt({ password: "" })).toEqual({
      ok: false,
      code: "reauth_required",
    });
    expectNothingDeleted();
  });

  it("still needs the typed word, before anything else is touched", async () => {
    signedInAs(googleOnly, amrAt(1));
    expect(await attempt({ confirmation: "delete", password: "" })).toEqual({
      ok: false,
      code: "bad_confirmation",
    });
    expectNothingTouched();
  });

  it("still counts every attempt against the hourly limit", async () => {
    signedInAs(googleOnly, amrAt(60 * 60));
    for (let i = 0; i < 5; i += 1) {
      expect(await attempt({ password: "" })).toEqual({
        ok: false,
        code: "reauth_required",
      });
    }
    expect(await attempt({ password: "" })).toEqual({
      ok: false,
      code: "rate_limited",
    });
  });

  it("still returns not_signed_in when the user differs from the session", async () => {
    signedInAs({ ...googleOnly, id: "someone-else" }, amrAt(1));
    expect(await attempt({ password: "" })).toEqual({
      ok: false,
      code: "not_signed_in",
    });
    expectNothingDeleted();
  });

  it("reads the providers from app_metadata when there are no identities", async () => {
    signedInAs(
      { email: EMAIL, app_metadata: { providers: ["google"] } },
      amrAt(1),
    );
    expect(await attempt({ password: "" })).toEqual({ ok: true });
  });

  it("reads the providers from app_metadata when the identities list is empty", async () => {
    signedInAs(
      { email: EMAIL, identities: [], app_metadata: { providers: ["google"] } },
      amrAt(1),
    );
    expect(await attempt({ password: "" })).toEqual({ ok: true });
  });

  it("does not log the claims, the user or the email", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    signedInAs(googleOnly, amrAt(60 * 60));
    await attempt({ password: "" });
    fake.getClaims.mockImplementation(() => Promise.reject(new Error(EMAIL)));
    await attempt({ password: "" });
    const all = JSON.stringify(error.mock.calls);
    expect(all).not.toContain(EMAIL);
    expect(all).not.toContain(userId);
  });
});

describe("deleteOwnAccount for an account that has a password", () => {
  it("keeps the password check when the account has both an email and a Google identity", async () => {
    signedInAs(
      {
        email: EMAIL,
        identities: [{ provider: "google" }, { provider: "email" }],
        app_metadata: { providers: ["google", "email"] },
      },
      amrAt(1),
    );
    expect(await attempt()).toEqual({ ok: true });
    expect(fake.signInWithPassword).toHaveBeenCalledWith({
      email: EMAIL,
      password: PASSWORD,
    });
    expect(fake.getClaims).not.toHaveBeenCalled();
  });

  it("does not accept a recent Google sign-in in place of the password", async () => {
    signedInAs(
      {
        email: EMAIL,
        identities: [{ provider: "email" }, { provider: "google" }],
      },
      amrAt(1),
    );
    fake.signInWithPassword.mockImplementation(() =>
      ok({
        data: { session: null },
        error: { status: 400, code: "invalid_credentials", message: "bad" },
      }),
    );
    expect(await attempt({ password: "" })).toEqual({
      ok: false,
      code: "bad_password",
    });
    expect(await attempt({ password: "wrong" })).toEqual({
      ok: false,
      code: "bad_password",
    });
    expectNothingDeleted();
  });

  it("uses the password path for an email-only account whatever the sign-in age", async () => {
    signedInAs(
      { email: EMAIL, identities: [{ provider: "email" }] },
      amrAt(24 * 60 * 60),
    );
    expect(await attempt()).toEqual({ ok: true });
  });

  it("falls back to app_metadata.providers for an email account", async () => {
    signedInAs(
      { email: EMAIL, app_metadata: { providers: ["email"] } },
      amrAt(1),
    );
    expect(await attempt()).toEqual({ ok: true });
    expect(fake.signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it("treats an account with no provider information as a password account", async () => {
    signedInAs({ email: EMAIL }, amrAt(1));
    fake.signInWithPassword.mockImplementation(() =>
      ok({
        data: { session: null },
        error: { status: 400, code: "invalid_credentials", message: "bad" },
      }),
    );
    expect(await attempt({ password: "" })).toEqual({
      ok: false,
      code: "bad_password",
    });
    expectNothingDeleted();
  });
});

describe("accountRequiresPassword", () => {
  it("is false only when the signed-in user has no password identity", async () => {
    signedInAs(googleOnly, null);
    expect(await deletion.accountRequiresPassword()).toBe(false);

    signedInAs({ email: EMAIL, identities: [{ provider: "email" }] }, null);
    expect(await deletion.accountRequiresPassword()).toBe(true);

    signedInAs(
      {
        email: EMAIL,
        identities: [{ provider: "google" }, { provider: "email" }],
      },
      null,
    );
    expect(await deletion.accountRequiresPassword()).toBe(true);
  });

  it("is true when the user cannot be read", async () => {
    fake.getUser.mockImplementation(() =>
      ok({ data: { user: null }, error: { status: 401 } }),
    );
    expect(await deletion.accountRequiresPassword()).toBe(true);
    fake.getUser.mockImplementation(() => Promise.reject(new Error("x")));
    expect(await deletion.accountRequiresPassword()).toBe(true);
    fake.requestCreateClient.mockImplementation(() =>
      Promise.reject(new Error("no cookies")),
    );
    expect(await deletion.accountRequiresPassword()).toBe(true);
  });
});
