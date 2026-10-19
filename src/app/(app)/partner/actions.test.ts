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
  userId: "user-1",
  headers: { origin: "https://astrapair.test" } as Record<string, string>,
  rpcResult: { data: "2026-10-07T00:00:00.000Z", error: null } as RpcResult,
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
  trackAfterResponse: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => fake.headers[name] ?? null,
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: fake.revalidatePath }));
vi.mock("@/lib/auth/session", () => ({
  requireOnboardedUserId: async () => fake.userId,
}));
vi.mock("@/lib/analytics/track", () => ({
  trackAfterResponse: fake.trackAfterResponse,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (...args: unknown[]) => {
      fake.rpc(...args);
      return Promise.resolve(fake.rpcResult);
    },
  }),
}));

import { cancelInvite, createInviteLink, disconnect } from "./actions";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

let n = 0;
beforeEach(() => {
  n += 1;
  fake.userId = `user-${n}`; // the rate limiter is module state; isolate per test
  fake.headers = { origin: "https://astrapair.test" };
  fake.rpcResult = { data: "2026-10-07T00:00:00.000Z", error: null };
  fake.rpc.mockClear();
  fake.revalidatePath.mockClear();
  fake.trackAfterResponse.mockClear();
});

describe("createInviteLink", () => {
  it("requires the share consent checkbox and does not call rpc", async () => {
    const state = await createInviteLink({}, form({}));
    expect(state.fieldErrors?.shareConsent).toEqual([
      "Tick the box to confirm what you're sharing.",
    ]);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("creates an invite with a hashed token and returns the invite URL", async () => {
    const state = await createInviteLink({}, form({ shareConsent: "on" }));

    expect(fake.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = fake.rpc.mock.calls[0] as [
      string,
      { p_token_hash: string; p_policy_version: string },
    ];
    expect(name).toBe("create_invite");
    expect(args.p_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(args.p_policy_version).toBe(POLICY_VERSION);

    expect(state.message).toMatch(
      /^https:\/\/astrapair\.test\/invite\/[A-Za-z0-9_-]{43}$/,
    );
    const token = state.message!.split("/invite/")[1];
    expect(createHash("sha256").update(token).digest("hex")).toBe(
      args.p_token_hash,
    );
    expect(state.values).toEqual({ expiresAt: "2026-10-07T00:00:00.000Z" });
  });

  it("falls back to the host header over https when there is no origin", async () => {
    fake.headers = { host: "app.example.com" };
    const state = await createInviteLink({}, form({ shareConsent: "on" }));
    expect(state.message).toMatch(/^https:\/\/app\.example\.com\/invite\//);
  });

  it("maps database error codes to friendly copy", async () => {
    fake.rpcResult = { error: { message: "no_birth_profile" } };
    const state = await createInviteLink({}, form({ shareConsent: "on" }));
    expect(state).toEqual({
      error: "Add your birth details before inviting a partner.",
    });
  });

  it("logs only a fixed message and the code for an unmapped error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.rpcResult = {
      error: { code: "XX000", message: "secret-hash-1990-07-15" },
    };
    const state = await createInviteLink({}, form({ shareConsent: "on" }));
    expect(state).toEqual({ error: "Something went wrong. Please try again." });
    expect(spy).toHaveBeenCalledWith("create invite failed", {
      code: "XX000",
    });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret-hash");
    spy.mockRestore();
  });

  it("does not log a mapped error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.rpcResult = { error: { message: "no_birth_profile" } };
    await createInviteLink({}, form({ shareConsent: "on" }));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("revalidates the partner page after creating a link", async () => {
    await createInviteLink({}, form({ shareConsent: "on" }));
    expect(fake.revalidatePath).toHaveBeenCalledWith("/partner");
  });

  it("limits to 10 invites per hour per user", async () => {
    for (let i = 0; i < 10; i++) {
      const ok = await createInviteLink({}, form({ shareConsent: "on" }));
      expect(ok.error).toBeUndefined();
    }
    const limited = await createInviteLink({}, form({ shareConsent: "on" }));
    expect(limited.error).toBe(
      "Too many attempts. Please wait a little and try again.",
    );
    expect(fake.rpc).toHaveBeenCalledTimes(10);
  });
});

describe("createInviteLink analytics", () => {
  it("tracks partner_invited once after an invite is created", async () => {
    await createInviteLink({}, form({ shareConsent: "on" }));
    expect(fake.trackAfterResponse).toHaveBeenCalledTimes(1);
    expect(fake.trackAfterResponse).toHaveBeenCalledWith(
      "partner_invited",
      fake.userId,
    );
  });

  it("does not track without consent, when rate limited, or on a database error", async () => {
    await createInviteLink({}, form({}));
    fake.rpcResult = { error: { message: "no_birth_profile" } };
    await createInviteLink({}, form({ shareConsent: "on" }));
    fake.rpcResult = { error: { code: "XX000", message: "x" } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await createInviteLink({}, form({ shareConsent: "on" }));
    spy.mockRestore();
    expect(fake.trackAfterResponse).not.toHaveBeenCalled();
  });

  it("does not track when the hourly limit is hit", async () => {
    for (let i = 0; i < 10; i++) {
      await createInviteLink({}, form({ shareConsent: "on" }));
    }
    fake.trackAfterResponse.mockClear();
    await createInviteLink({}, form({ shareConsent: "on" }));
    expect(fake.trackAfterResponse).not.toHaveBeenCalled();
  });
});

describe("cancelInvite", () => {
  it("revokes the invite and revalidates the partner page", async () => {
    fake.rpcResult = { data: null, error: null };
    await cancelInvite();
    expect(fake.rpc).toHaveBeenCalledWith("revoke_invite");
    expect(fake.revalidatePath).toHaveBeenCalledWith("/partner");
  });
});

describe("disconnect", () => {
  it("rejects a non-uuid relationship id without calling rpc", async () => {
    const state = await disconnect({}, form({ relationshipId: "nope" }));
    expect(state.error).toBe("Something went wrong. Please try again.");
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("ends the relationship, revalidates and redirects to /partner", async () => {
    fake.rpcResult = { data: null, error: null };
    const id = "0b9b3a5e-5d3c-4c0e-9d4b-2f1f6f5a7c11";
    await expect(
      disconnect({}, form({ relationshipId: id })),
    ).rejects.toMatchObject({ url: "/partner" });
    expect(fake.rpc).toHaveBeenCalledWith("end_relationship", {
      p_relationship_id: id,
    });
    expect(fake.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("treats not_a_member as already disconnected", async () => {
    fake.rpcResult = { error: { message: "not_a_member" } };
    await expect(
      disconnect(
        {},
        form({ relationshipId: "0b9b3a5e-5d3c-4c0e-9d4b-2f1f6f5a7c11" }),
      ),
    ).rejects.toMatchObject({ url: "/partner" });
    expect(fake.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("maps other database errors and logs unmapped ones by code only", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.rpcResult = { error: { code: "XX000", message: "boom 1990-07-15" } };
    const state = await disconnect(
      {},
      form({ relationshipId: "0b9b3a5e-5d3c-4c0e-9d4b-2f1f6f5a7c11" }),
    );
    expect(state.error).toBe("Something went wrong. Please try again.");
    expect(spy).toHaveBeenCalledWith("disconnect failed", { code: "XX000" });
    expect(fake.revalidatePath).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
