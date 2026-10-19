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

async function signedInUser(): Promise<TestUser> {
  const email = `chart-rls-${randomUUID()}@example.test`;
  const password = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
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

const profileFor = (ownerId: string) => ({
  owner_user_id: ownerId,
  display_name: "Test",
  birth_date: "1990-07-15",
  birth_time: "12:00",
  birth_time_accuracy: "exact",
  birth_place_label: "Colombo, Western Province, Sri Lanka",
  latitude: 6.93548,
  longitude: 79.84868,
  timezone_id: "Asia/Colombo",
});

let alice: TestUser;
let bob: TestUser;
let aliceProfileId: string;

beforeAll(async () => {
  alice = await signedInUser();
  bob = await signedInUser();
  const { data, error } = await alice.client
    .from("birth_profiles")
    .insert(profileFor(alice.id))
    .select("id")
    .single();
  if (error) throw error;
  aliceProfileId = data.id;
  // Charts are server-written only: seed with the secret-key client.
  const { error: chartError } = await admin.from("charts").insert({
    birth_profile_id: aliceProfileId,
    calculation_provider: "astrapair-builtin",
    calculation_version: "1.0.0",
    input_hash: "a".repeat(64),
    chart_json: { test: true },
  });
  if (chartError) throw chartError;
});

afterAll(async () => {
  await Promise.all(
    createdUserIds.map((id) => admin.auth.admin.deleteUser(id)),
  );
});

describe("birth_profiles RLS", () => {
  it("lets the owner read their profile", async () => {
    const { data } = await alice.client.from("birth_profiles").select("id");
    expect(data?.map((r) => r.id)).toEqual([aliceProfileId]);
  });

  it("hides another user's profile", async () => {
    const { data } = await bob.client
      .from("birth_profiles")
      .select("*")
      .eq("id", aliceProfileId);
    expect(data).toEqual([]);
  });

  it("stops another user updating or deleting it", async () => {
    const upd = await bob.client
      .from("birth_profiles")
      .update({ display_name: "x" })
      .eq("id", aliceProfileId)
      .select("id");
    expect(upd.data).toEqual([]);
    const del = await bob.client
      .from("birth_profiles")
      .delete()
      .eq("id", aliceProfileId)
      .select("id");
    expect(del.data).toEqual([]);

    const { data: row } = await admin
      .from("birth_profiles")
      .select("id, display_name")
      .eq("id", aliceProfileId)
      .single();
    expect(row).toEqual({ id: aliceProfileId, display_name: "Test" });
  });

  it("rejects creating a profile for someone else", async () => {
    const { error } = await bob.client
      .from("birth_profiles")
      .insert(profileFor(alice.id));
    // 42501 (RLS), not 23505: the policy must reject before uniqueness matters.
    expect(error?.code).toBe("42501");
  });

  it("rejects an exact accuracy with no birth time", async () => {
    const { error } = await bob.client
      .from("birth_profiles")
      .insert({ ...profileFor(bob.id), birth_time: null });
    expect(error?.code).toBe("23514");
  });

  it("rejects a birth time with unknown accuracy", async () => {
    const { error } = await bob.client.from("birth_profiles").insert({
      ...profileFor(bob.id),
      birth_time: "09:00",
      birth_time_accuracy: "unknown",
    });
    expect(error?.code).toBe("23514");
  });

  it("denies anonymous access", async () => {
    const { error } = await anon.from("birth_profiles").select("*").limit(1);
    expect(error?.code).toBe("42501");
  });
});

describe("charts RLS", () => {
  it("lets the owner read their charts", async () => {
    const { data } = await alice.client
      .from("charts")
      .select("id")
      .eq("birth_profile_id", aliceProfileId);
    expect(data).toHaveLength(1);
  });

  it("hides charts from other users", async () => {
    const { data } = await bob.client
      .from("charts")
      .select("*")
      .eq("birth_profile_id", aliceProfileId);
    expect(data).toEqual([]);
  });

  it("stops other users inserting charts on someone else's profile", async () => {
    const { error } = await bob.client.from("charts").insert({
      birth_profile_id: aliceProfileId,
      calculation_provider: "x",
      calculation_version: "x",
      input_hash: "b".repeat(64),
      chart_json: {},
    });
    expect(error?.code).toBe("42501");
  });

  it("stops the owner inserting a chart directly", async () => {
    const { error } = await alice.client.from("charts").insert({
      birth_profile_id: aliceProfileId,
      calculation_provider: "x",
      calculation_version: "x",
      input_hash: "c".repeat(64),
      chart_json: { forged: true },
    });
    expect(error?.code).toBe("42501");
  });

  it("stops other users deleting a chart", async () => {
    const del = await bob.client
      .from("charts")
      .delete()
      .eq("birth_profile_id", aliceProfileId)
      .select("id");
    expect(del.error?.code).toBe("42501");

    const { count } = await admin
      .from("charts")
      .select("id", { count: "exact", head: true })
      .eq("birth_profile_id", aliceProfileId);
    expect(count).toBe(1);
  });

  it("stops the owner deleting a chart directly", async () => {
    const del = await alice.client
      .from("charts")
      .delete()
      .eq("birth_profile_id", aliceProfileId)
      .select("id");
    expect(del.error?.code).toBe("42501");

    const { count } = await admin
      .from("charts")
      .select("id", { count: "exact", head: true })
      .eq("birth_profile_id", aliceProfileId);
    expect(count).toBe(1);
  });

  it("denies anonymous access", async () => {
    const { error } = await anon.from("charts").select("*").limit(1);
    expect(error?.code).toBe("42501");
  });

  it("does not allow updating a chart", async () => {
    const { error } = await alice.client
      .from("charts")
      .update({ chart_json: {} })
      .eq("birth_profile_id", aliceProfileId);
    expect(error?.code).toBe("42501");
  });
});

describe("audit events", () => {
  it("records profile creation without birth data", async () => {
    const { data } = await admin
      .from("audit_events")
      .select("event_type, resource_id, metadata")
      .eq("actor_user_id", alice.id)
      .eq("event_type", "birth_profile.created");
    expect(data).toHaveLength(1);
    expect(data![0].resource_id).toBe(aliceProfileId);
    expect(JSON.stringify(data![0].metadata)).not.toMatch(/1990|Colombo|6\.93/);
  });
});
