import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

class RedirectError extends Error {
  constructor(readonly url: string) {
    super(`redirect:${url}`);
  }
}

const fake = vi.hoisted(() => ({
  claims: null as unknown,
  profile: null as unknown,
  createClientThrows: false,
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));
// React's per-request cache is not available outside a request: run each call.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <T>(fn: T) => fn,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    if (fake.createClientThrows) throw new Error("Invalid public environment");
    return {
      auth: { getClaims: async () => fake.claims },
      from: () => ({
        select: () => ({
          eq: () => ({ single: async () => fake.profile }),
        }),
      }),
    };
  },
}));

import {
  getProfile,
  getUserId,
  requireOnboardedUserId,
  requireUserId,
} from "./session";

beforeEach(() => {
  fake.claims = { data: { claims: { sub: "user-1" } }, error: null };
  fake.profile = {
    data: { id: "user-1", display_name: "Sam", onboarded_at: "2026-09-01" },
    error: null,
  };
  fake.createClientThrows = false;
});

describe("getUserId", () => {
  it("returns the id from the verified claims", async () => {
    expect(await getUserId()).toBe("user-1");
  });

  // When the auth service cannot be reached, getClaims returns an error and no
  // data. The person is treated as signed out, never as someone else.
  it("treats unreadable claims as signed out", async () => {
    fake.claims = { data: null, error: { message: "fetch failed" } };
    expect(await getUserId()).toBeNull();
    fake.claims = { data: { claims: null }, error: null };
    expect(await getUserId()).toBeNull();
  });
});

describe("requireUserId", () => {
  it("sends a signed-out visitor, or one whose session cannot be read, to sign in", async () => {
    fake.claims = { data: null, error: { message: "fetch failed" } };
    await expect(requireUserId()).rejects.toMatchObject({ url: "/login" });
  });
});

describe("getProfile", () => {
  it("returns the profile row", async () => {
    expect(await getProfile()).toMatchObject({ display_name: "Sam" });
  });

  // This is what a database outage on page load looks like: the page throws,
  // and the (app) error boundary shows "Something went wrong" with Try again.
  it("throws a fixed error when the database fails, without its details", async () => {
    fake.profile = {
      data: null,
      error: { code: "08006", message: "connection to 10.0.0.5 failed" },
    };
    const failure = await getProfile().catch((e: Error) => e);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("Failed to load profile");
    expect((failure as Error).message).not.toContain("10.0.0.5");
  });

  it("throws, rather than redirecting, when the client cannot be built", async () => {
    fake.createClientThrows = true;
    await expect(getProfile()).rejects.toThrow();
  });
});

describe("requireOnboardedUserId", () => {
  it("returns the id for an onboarded user", async () => {
    expect(await requireOnboardedUserId()).toBe("user-1");
  });

  it("sends a user who has not finished onboarding to /onboarding", async () => {
    fake.profile = {
      data: { id: "user-1", display_name: "Sam", onboarded_at: null },
      error: null,
    };
    await expect(requireOnboardedUserId()).rejects.toMatchObject({
      url: "/onboarding",
    });
  });

  it("does not send a user to onboarding when their profile failed to load", async () => {
    fake.profile = { data: null, error: { code: "08006" } };
    await expect(requireOnboardedUserId()).rejects.toThrow(
      "Failed to load profile",
    );
  });
});
