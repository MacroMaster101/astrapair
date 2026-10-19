import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, Json } from "@/lib/supabase/database.types";

// Needs the 20261001110000_beta_gate.sql migration applied to the dev project.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

const admin = createClient<Database>(url, secretKey, noSession);
const anon = createClient<Database>(url, publishableKey, noSession);

const createdHashes: string[] = [];
const createdUserIds: string[] = [];
let authed: SupabaseClient<Database>;

const REJECTED = {
  error: { message: "beta_code_invalid", http_code: 403 },
};

function hashOf(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

function newCode(): string {
  return `T${randomBytes(8).toString("hex").toUpperCase()}`;
}

function isAllowed(result: unknown): boolean {
  return JSON.stringify(result) === JSON.stringify({});
}

function isRejected(result: unknown): boolean {
  return JSON.stringify(result) === JSON.stringify(REJECTED);
}

async function insertCode(
  options: { maxUses?: number; disabled?: boolean } = {},
): Promise<string> {
  const code = newCode();
  const code_hash = hashOf(code);
  createdHashes.push(code_hash);
  const { error } = await admin.from("beta_invite_codes").insert({
    code_hash,
    label: `integration-${randomUUID()}`,
    max_uses: options.maxUses ?? 1,
    disabled_at: options.disabled ? new Date().toISOString() : null,
  });
  if (error) throw error;
  return code;
}

async function usesOf(code: string): Promise<number> {
  const { data, error } = await admin
    .from("beta_invite_codes")
    .select("uses")
    .eq("code_hash", hashOf(code))
    .single();
  if (error) throw error;
  return data.uses;
}

/** What the auth server sends to a "Before user created" hook. */
function hookEvent(metadata: Record<string, Json | undefined>): Json {
  return {
    user: {
      id: randomUUID(),
      email: `beta-gate-${randomUUID()}@example.test`,
      user_metadata: metadata,
    },
    metadata: { name: "before-user-created" },
  };
}

async function callHook(event: Json) {
  const { data, error } = await admin.rpc("hook_before_user_created", {
    event,
  });
  expect(error).toBeNull();
  return data;
}

beforeAll(async () => {
  const email = `beta-gate-${randomUUID()}@example.test`;
  const password = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  createdUserIds.push(data.user.id);

  authed = createClient<Database>(url, publishableKey, noSession);
  const { error: signInError } = await authed.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) throw signInError;
});

afterAll(async () => {
  // delete is not granted in the migration: service_role has it through
  // Supabase's default privileges on public tables.
  if (createdHashes.length > 0) {
    const { error } = await admin
      .from("beta_invite_codes")
      .delete()
      .in("code_hash", createdHashes);
    expect(error).toBeNull();
  }
  for (const id of createdUserIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    expect(error).toBeNull();
  }
});

describe("hook_before_user_created", () => {
  it("rejects a sign-up with no code", async () => {
    expect(await callHook(hookEvent({}))).toEqual(REJECTED);
    expect(await callHook(hookEvent({ display_name: "Sam" }))).toEqual(
      REJECTED,
    );
  });

  it("rejects an empty, non-string or over-long code without raising", async () => {
    for (const beta_code of [
      "",
      null,
      42,
      true,
      ["ABC"],
      { code: "ABC" },
      "A".repeat(65),
    ] as Json[]) {
      expect(
        await callHook(hookEvent({ beta_code })),
        JSON.stringify(beta_code),
      ).toEqual(REJECTED);
    }
    expect(await callHook({})).toEqual(REJECTED);
    expect(await callHook({ user: null })).toEqual(REJECTED);
    expect(await callHook({ user: { user_metadata: "text" } })).toEqual(
      REJECTED,
    );
  });

  it("rejects an unknown code", async () => {
    expect(await callHook(hookEvent({ beta_code: newCode() }))).toEqual(
      REJECTED,
    );
  });

  it("accepts a valid code once and counts the use", async () => {
    const code = await insertCode();
    expect(await callHook(hookEvent({ beta_code: code }))).toEqual({});
    expect(await usesOf(code)).toBe(1);
  });

  it("does not count a rejected attempt", async () => {
    const code = await insertCode({ maxUses: 1 });
    await callHook(hookEvent({ beta_code: code }));
    expect(await callHook(hookEvent({ beta_code: code }))).toEqual(REJECTED);
    expect(await usesOf(code)).toBe(1);
  });

  it("rejects an exhausted code and allows a multi-use code up to its limit", async () => {
    const code = await insertCode({ maxUses: 2 });
    expect(await callHook(hookEvent({ beta_code: code }))).toEqual({});
    expect(await callHook(hookEvent({ beta_code: code }))).toEqual({});
    expect(await callHook(hookEvent({ beta_code: code }))).toEqual(REJECTED);
    expect(await usesOf(code)).toBe(2);
  });

  it("accepts a code typed in lower case or with hyphens or spaces", async () => {
    const code = await insertCode({ maxUses: 4 });
    const grouped = `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
    for (const typed of [
      code.toLowerCase(),
      grouped,
      grouped.toLowerCase(),
      ` ${code.slice(0, 6)} ${code.slice(6)} `,
    ]) {
      expect(await callHook(hookEvent({ beta_code: typed })), typed).toEqual(
        {},
      );
    }
    expect(await usesOf(code)).toBe(4);
  });

  it("applies the length limit to what was sent, and rejects a code of only separators", async () => {
    const code = await insertCode();
    expect(
      await callHook(hookEvent({ beta_code: `${code}${" ".repeat(60)}` })),
    ).toEqual(REJECTED);
    expect(await callHook(hookEvent({ beta_code: "- - -" }))).toEqual(REJECTED);
    expect(await usesOf(code)).toBe(0);
  });

  it("rejects a disabled code", async () => {
    const code = await insertCode({ disabled: true });
    expect(await callHook(hookEvent({ beta_code: code }))).toEqual(REJECTED);
    expect(await usesOf(code)).toBe(0);
  });

  it("lets exactly one of two parallel sign-ups use a single-use code", async () => {
    const code = await insertCode({ maxUses: 1 });
    const results = await Promise.all([
      callHook(hookEvent({ beta_code: code })),
      callHook(hookEvent({ beta_code: code })),
    ]);
    expect(results.filter(isAllowed)).toHaveLength(1);
    expect(results.filter(isRejected)).toHaveLength(1);
    expect(await usesOf(code)).toBe(1);
  });

  it("holds the limit under a larger race", async () => {
    const code = await insertCode({ maxUses: 3 });
    const results = await Promise.all(
      Array.from({ length: 8 }, () => callHook(hookEvent({ beta_code: code }))),
    );
    expect(results.filter(isAllowed)).toHaveLength(3);
    expect(results.filter(isRejected)).toHaveLength(5);
    expect(await usesOf(code)).toBe(3);
  });
});

describe("check_beta_code", () => {
  async function check(code: string | null) {
    const { data, error } = await admin.rpc("check_beta_code", {
      p_code: code as string,
    });
    expect(error).toBeNull();
    return data;
  }

  it("is true for a live code and does not use it up", async () => {
    const code = await insertCode({ maxUses: 1 });
    expect(await check(code)).toBe(true);
    expect(await check(code)).toBe(true);
    expect(await usesOf(code)).toBe(0);
    expect(await callHook(hookEvent({ beta_code: code }))).toEqual({});
  });

  it("is false for unknown, disabled and used up codes", async () => {
    expect(await check(newCode())).toBe(false);
    expect(await check(await insertCode({ disabled: true }))).toBe(false);
    const used = await insertCode({ maxUses: 1 });
    await callHook(hookEvent({ beta_code: used }));
    expect(await check(used)).toBe(false);
  });

  it("is false for null, empty, separator-only and over-long input, without raising", async () => {
    for (const input of [null, "", "  ", "- -", "A".repeat(65)]) {
      expect(await check(input), String(input)).toBe(false);
    }
  });

  it("normalises like the hook", async () => {
    const code = await insertCode();
    const grouped = `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
    for (const typed of [code.toLowerCase(), grouped, ` ${grouped} `]) {
      expect(await check(typed), typed).toBe(true);
    }
    expect(await usesOf(code)).toBe(0);
  });
});

describe("access", () => {
  it("is not executable by signed-in users or anonymous callers", async () => {
    const code = await insertCode();
    for (const client of [authed, anon]) {
      const { error } = await client.rpc("hook_before_user_created", {
        event: hookEvent({ beta_code: code }),
      });
      expect(error?.code).toBe("42501");
    }
    expect(await usesOf(code)).toBe(0);
  });

  it("does not let signed-in users or anonymous callers check codes", async () => {
    const code = await insertCode();
    for (const client of [authed, anon]) {
      const { data, error } = await client.rpc("check_beta_code", {
        p_code: code,
      });
      expect(error?.code).toBe("42501");
      expect(data).toBeNull();
    }
  });

  it("keeps the codes table closed to signed-in users and anonymous callers", async () => {
    const code = await insertCode();
    for (const client of [authed, anon]) {
      const read = await client.from("beta_invite_codes").select("*");
      expect(read.error !== null || (read.data ?? []).length === 0).toBe(true);

      const insert = await client.from("beta_invite_codes").insert({
        code_hash: hashOf(newCode()),
        label: "should-not-exist",
      });
      expect(insert.error).not.toBeNull();

      const update = await client
        .from("beta_invite_codes")
        .update({ max_uses: 1000 })
        .eq("code_hash", hashOf(code))
        .select();
      expect(update.error !== null || (update.data ?? []).length === 0).toBe(
        true,
      );
    }
    const { data, error } = await admin
      .from("beta_invite_codes")
      .select("max_uses")
      .eq("code_hash", hashOf(code))
      .single();
    expect(error).toBeNull();
    expect(data?.max_uses).toBe(1);
  });

  it("stores a hash, never the code", async () => {
    const code = await insertCode();
    const { data, error } = await admin
      .from("beta_invite_codes")
      .select("*")
      .eq("code_hash", hashOf(code))
      .single();
    expect(error).toBeNull();
    expect(JSON.stringify(data)).not.toContain(code);
    expect(data?.code_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
