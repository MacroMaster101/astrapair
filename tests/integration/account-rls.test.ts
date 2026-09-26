import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

type TestUser = { id: string; client: SupabaseClient<Database> };

const admin = createClient<Database>(url, secretKey, noSession);
const anon = createClient<Database>(url, publishableKey, noSession);
const createdUserIds: string[] = [];

async function createSignedInUser(displayName: string): Promise<TestUser> {
  const email = `rls-test-${randomUUID()}@example.test`;
  const password = randomBytes(24).toString("base64url");

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (error) throw error;
  createdUserIds.push(data.user.id);

  const client = createClient<Database>(url, publishableKey, noSession);
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) throw signInError;

  return { id: data.user.id, client };
}

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  alice = await createSignedInUser("Alice Test");
  bob = await createSignedInUser("Bob Test");
});

afterAll(async () => {
  // Cascades to profiles and consents; audit events keep a null actor.
  await Promise.all(
    createdUserIds.map((id) => admin.auth.admin.deleteUser(id)),
  );
});

describe("sign-up trigger", () => {
  it("creates a profile with the display name from sign-up metadata", async () => {
    const { data, error } = await alice.client
      .from("profiles")
      .select("*")
      .eq("id", alice.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].display_name).toBe("Alice Test");
    expect(data![0].onboarded_at).toBeNull();
  });

  it("records an account.created audit event", async () => {
    const { data } = await admin
      .from("audit_events")
      .select("event_type")
      .eq("actor_user_id", alice.id);
    expect(data?.map((e) => e.event_type)).toContain("account.created");
  });
});

describe("profiles RLS", () => {
  it("only returns the caller's own profile", async () => {
    const { data } = await alice.client.from("profiles").select("id");
    expect(data?.map((p) => p.id)).toEqual([alice.id]);
  });

  it("hides another user's profile when queried by id", async () => {
    const { data, error } = await alice.client
      .from("profiles")
      .select("*")
      .eq("id", bob.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("lets a user update their own display name", async () => {
    const { data, error } = await alice.client
      .from("profiles")
      .update({ display_name: "Alice Renamed" })
      .eq("id", alice.id)
      .select("display_name");
    expect(error).toBeNull();
    expect(data).toEqual([{ display_name: "Alice Renamed" }]);
  });

  it("silently affects zero rows when updating another user's profile", async () => {
    const { data } = await alice.client
      .from("profiles")
      .update({ display_name: "hacked" })
      .eq("id", bob.id)
      .select("id");
    expect(data).toEqual([]);

    const { data: bobProfile } = await admin
      .from("profiles")
      .select("display_name")
      .eq("id", bob.id)
      .single();
    expect(bobProfile?.display_name).toBe("Bob Test");
  });

  it("rejects direct writes to onboarded_at", async () => {
    const { error } = await alice.client
      .from("profiles")
      .update({ onboarded_at: new Date().toISOString() })
      .eq("id", alice.id);
    expect(error?.code).toBe("42501");
  });

  it("rejects inserting or deleting profiles", async () => {
    const insert = await alice.client
      .from("profiles")
      .insert({ id: randomUUID() });
    expect(insert.error?.code).toBe("42501");

    const del = await alice.client.from("profiles").delete().eq("id", alice.id);
    expect(del.error?.code).toBe("42501");
  });
});

describe("consents and onboarding", () => {
  it("rejects inserting consents directly", async () => {
    const { error } = await alice.client.from("consents").insert({
      user_id: alice.id,
      consent_type: "terms",
      policy_version: "forged",
    });
    expect(error?.code).toBe("42501");
  });

  it("records consents and marks the profile onboarded", async () => {
    const { error } = await alice.client.rpc("complete_onboarding", {
      p_policy_version: "test-v1",
    });
    expect(error).toBeNull();

    const { data: consents } = await alice.client
      .from("consents")
      .select("consent_type, policy_version");
    expect(consents?.map((c) => c.consent_type).sort()).toEqual([
      "age_confirmation",
      "privacy",
      "terms",
    ]);
    expect(consents?.every((c) => c.policy_version === "test-v1")).toBe(true);

    const { data: profile } = await alice.client
      .from("profiles")
      .select("onboarded_at")
      .eq("id", alice.id)
      .single();
    expect(profile?.onboarded_at).not.toBeNull();
  });

  it("is idempotent", async () => {
    await alice.client.rpc("complete_onboarding", {
      p_policy_version: "test-v2",
    });
    const { data } = await alice.client.from("consents").select("id");
    expect(data).toHaveLength(3);
  });

  it("rejects an invalid policy version", async () => {
    const { error } = await bob.client.rpc("complete_onboarding", {
      p_policy_version: "",
    });
    expect(error?.code).toBe("22023");
  });

  it("does not expose another user's consents", async () => {
    const { data } = await bob.client
      .from("consents")
      .select("*")
      .eq("user_id", alice.id);
    expect(data).toEqual([]);
  });
});

describe("audit_events", () => {
  it("is not readable by signed-in users", async () => {
    const { error } = await alice.client.from("audit_events").select("*");
    expect(error?.code).toBe("42501");
  });

  it("is not writable by signed-in users", async () => {
    const { error } = await alice.client
      .from("audit_events")
      .insert({ event_type: "forged", actor_user_id: alice.id });
    expect(error?.code).toBe("42501");
  });
});

describe("anonymous access", () => {
  it.each(["profiles", "consents", "audit_events"] as const)(
    "is denied on %s",
    async (table) => {
      const { error } = await anon.from(table).select("*").limit(1);
      expect(error?.code).toBe("42501");
    },
  );

  it("cannot call complete_onboarding", async () => {
    const { error } = await anon.rpc("complete_onboarding", {
      p_policy_version: "x",
    });
    expect(error?.code).toBe("42501");
  });
});
