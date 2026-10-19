import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POLICY_VERSION } from "@/lib/legal";

vi.mock("server-only", () => ({}));

class RedirectError extends Error {
  constructor(readonly url: string) {
    super(`redirect:${url}`);
  }
}

type RpcResult = {
  data?: unknown;
  error?: { message?: string; code?: string } | null;
};

const fake = vi.hoisted(() => ({
  userId: "user-1" as string | null,
  onboardedAt: "2026-09-01T00:00:00Z" as string | null,
  rpcResult: { data: null, error: null } as RpcResult,
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
  trackAfterResponse: vi.fn(),
  order: [] as string[],
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    fake.order.push("redirect");
    throw new RedirectError(url);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: fake.revalidatePath }));
vi.mock("@/lib/auth/session", () => ({
  getUserId: async () => fake.userId,
  requireUserId: async () => {
    if (!fake.userId) throw new RedirectError("/login");
    return fake.userId;
  },
  getProfile: async () => ({
    id: fake.userId,
    display_name: "Test",
    onboarded_at: fake.onboardedAt,
  }),
}));
vi.mock("@/lib/analytics/track", () => ({
  trackAfterResponse: (...args: unknown[]) => {
    fake.order.push("track");
    fake.trackAfterResponse(...args);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (...args: unknown[]) => {
      fake.rpc(...args);
      return Promise.resolve(fake.rpcResult);
    },
  }),
}));

import { acceptInvite, declineInvite } from "./actions";

const TOKEN = "A".repeat(43);
const TOKEN_HASH = createHash("sha256").update(TOKEN).digest("hex");

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

let n = 0;
beforeEach(() => {
  n += 1;
  fake.userId = `user-${n}`; // the rate limiter is module state; isolate per test
  fake.onboardedAt = "2026-09-01T00:00:00Z";
  fake.rpcResult = { data: null, error: null };
  fake.rpc.mockClear();
  fake.revalidatePath.mockClear();
  fake.trackAfterResponse.mockClear();
  fake.order = [];
});

describe("acceptInvite", () => {
  it("rejects a malformed token without calling rpc or redirecting", async () => {
    const state = await acceptInvite(
      {},
      form({ token: "../evil", shareConsent: "on" }),
    );
    expect(state.error).toBe(
      "This invite link isn't valid. Ask your partner for a new one.",
    );
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("sends signed-out users to login and back to the invite", async () => {
    fake.userId = null;
    await expect(
      acceptInvite({}, form({ token: TOKEN, shareConsent: "on" })),
    ).rejects.toMatchObject({
      url: `/login?next=${encodeURIComponent(`/invite/${TOKEN}`)}`,
    });
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("sends users who have not onboarded to onboarding with next", async () => {
    fake.onboardedAt = null;
    await expect(
      acceptInvite({}, form({ token: TOKEN, shareConsent: "on" })),
    ).rejects.toMatchObject({ url: `/onboarding?next=%2Finvite%2F${TOKEN}` });
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("requires the share consent checkbox", async () => {
    const state = await acceptInvite({}, form({ token: TOKEN }));
    expect(state.fieldErrors?.shareConsent).toEqual([
      "Tick the box to confirm what you're sharing.",
    ]);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("accepts with the hashed token, revalidates and redirects to /partner", async () => {
    await expect(
      acceptInvite({}, form({ token: TOKEN, shareConsent: "on" })),
    ).rejects.toMatchObject({ url: "/partner" });
    expect(fake.rpc).toHaveBeenCalledWith("accept_invite", {
      p_token_hash: TOKEN_HASH,
      p_policy_version: POLICY_VERSION,
    });
    expect(fake.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("maps database error codes to friendly copy", async () => {
    fake.rpcResult = { error: { message: "invite_expired" } };
    const state = await acceptInvite(
      {},
      form({ token: TOKEN, shareConsent: "on" }),
    );
    expect(state.error).toBe(
      "This invite link has expired. Ask your partner for a new one.",
    );
    expect(fake.revalidatePath).not.toHaveBeenCalled();
  });

  it("logs an unmapped accept error by code only", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.rpcResult = { error: { code: "XX000", message: `bad ${TOKEN_HASH}` } };
    const state = await acceptInvite(
      {},
      form({ token: TOKEN, shareConsent: "on" }),
    );
    expect(state.error).toBe("Something went wrong. Please try again.");
    expect(spy).toHaveBeenCalledWith("accept invite failed", {
      code: "XX000",
    });
    expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN_HASH);
    spy.mockRestore();
  });

  it("limits to 30 attempts per minute per user", async () => {
    fake.rpcResult = { error: { message: "invite_used" } };
    for (let i = 0; i < 30; i++) {
      await acceptInvite({}, form({ token: TOKEN, shareConsent: "on" }));
    }
    const limited = await acceptInvite(
      {},
      form({ token: TOKEN, shareConsent: "on" }),
    );
    expect(limited.error).toBe(
      "Too many attempts. Please wait a little and try again.",
    );
    expect(fake.rpc).toHaveBeenCalledTimes(30);
  });
});

describe("acceptInvite analytics", () => {
  it("tracks partner_connected for the invitee before redirecting", async () => {
    const userId = fake.userId;
    await expect(
      acceptInvite({}, form({ token: TOKEN, shareConsent: "on" })),
    ).rejects.toMatchObject({ url: "/partner" });
    expect(fake.trackAfterResponse).toHaveBeenCalledTimes(1);
    expect(fake.trackAfterResponse).toHaveBeenCalledWith(
      "partner_connected",
      userId,
    );
    expect(fake.order).toEqual(["track", "redirect"]);
  });

  it("does not track when the accept fails", async () => {
    fake.rpcResult = { error: { message: "invite_expired" } };
    await acceptInvite({}, form({ token: TOKEN, shareConsent: "on" }));
    expect(fake.trackAfterResponse).not.toHaveBeenCalled();
  });

  it("does not track a malformed token, a signed-out user, or missing consent", async () => {
    await acceptInvite({}, form({ token: "../evil", shareConsent: "on" }));
    await acceptInvite({}, form({ token: TOKEN }));
    fake.userId = null;
    await expect(
      acceptInvite({}, form({ token: TOKEN, shareConsent: "on" })),
    ).rejects.toBeInstanceOf(RedirectError);
    expect(fake.trackAfterResponse).not.toHaveBeenCalled();
  });

  it("does not track a decline", async () => {
    await declineInvite({}, form({ token: TOKEN }));
    expect(fake.trackAfterResponse).not.toHaveBeenCalled();
  });
});

describe("declineInvite", () => {
  it("rejects a malformed token without calling rpc", async () => {
    const state = await declineInvite({}, form({ token: "short" }));
    expect(state.error).toBe(
      "This invite link isn't valid. Ask your partner for a new one.",
    );
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("declines with the hashed token", async () => {
    const state = await declineInvite({}, form({ token: TOKEN }));
    expect(state).toEqual({ message: "Invite declined." });
    expect(fake.rpc).toHaveBeenCalledWith("decline_invite", {
      p_token_hash: TOKEN_HASH,
    });
  });

  it("maps database error codes", async () => {
    fake.rpcResult = { error: { message: "invite_not_found" } };
    const state = await declineInvite({}, form({ token: TOKEN }));
    expect(state.error).toBe(
      "This invite link isn't valid. Ask your partner for a new one.",
    );
  });

  it("logs an unmapped decline error by code only", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.rpcResult = { error: { code: "XX000", message: "hidden" } };
    const state = await declineInvite({}, form({ token: TOKEN }));
    expect(state.error).toBe("Something went wrong. Please try again.");
    expect(spy).toHaveBeenCalledWith("decline invite failed", {
      code: "XX000",
    });
    spy.mockRestore();
  });
});
