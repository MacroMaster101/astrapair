import { createHash, randomBytes, randomUUID } from "node:crypto";
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
const deletedUserIds = new Set<string>();
const createdRelationshipIds: string[] = [];
const createdAuditEventTypes: string[] = [];
const createdUserRefs: string[] = [];

const POLICY = "test-v1";
const HASH = "c".repeat(64);
const DAY_MS = 24 * 60 * 60 * 1000;

function hexRef(): string {
  return randomBytes(32).toString("hex");
}

async function setupUser(displayName: string): Promise<TestUser> {
  const email = `hardening-rls-${randomUUID()}@example.test`;
  const password = randomBytes(24).toString("base64url");

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (error) throw error;
  const id = data.user.id;
  createdUserIds.push(id);

  const client = createClient<Database>(url, publishableKey, noSession);
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) throw signInError;

  const { error: onboardError } = await admin
    .from("profiles")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("id", id);
  if (onboardError) throw onboardError;

  const { error: profileError } = await admin.from("birth_profiles").insert({
    owner_user_id: id,
    display_name: displayName,
    birth_date: "1990-07-15",
    birth_time: "12:00",
    birth_time_accuracy: "exact",
    birth_place_label: "Colombo, Western Province, Sri Lanka",
    latitude: 6.93548,
    longitude: 79.84868,
    timezone_id: "Asia/Colombo",
  });
  if (profileError) throw profileError;
  return { id, client };
}

function newTokenHash(): string {
  return createHash("sha256")
    .update(randomBytes(32).toString("base64url"))
    .digest("hex");
}

async function connect(inviter: TestUser, invitee: TestUser): Promise<string> {
  const hash = newTokenHash();
  const { error: inviteError } = await inviter.client.rpc("create_invite", {
    p_token_hash: hash,
    p_policy_version: POLICY,
  });
  if (inviteError) throw inviteError;
  const { data, error } = await invitee.client.rpc("accept_invite", {
    p_token_hash: hash,
    p_policy_version: POLICY,
  });
  if (error) throw error;
  createdRelationshipIds.push(data!);
  return data!;
}

async function deleteUser(id: string) {
  const { error } = await admin.auth.admin.deleteUser(id);
  expect(error).toBeNull();
  deletedUserIds.add(id);
}

async function insertThread(
  ownerId: string,
  title: string,
  relationshipId?: string,
): Promise<string> {
  const { data, error } = await admin
    .from("ai_threads")
    .insert({
      owner_user_id: ownerId,
      relationship_id: relationshipId ?? null,
      thread_type: relationshipId ? "relationship" : "chart",
      title,
    })
    .select("id")
    .single();
  if (error) throw error;
  const { error: messageError } = await admin
    .from("ai_messages")
    .insert({ thread_id: data.id, role: "user", content: "Test question" });
  if (messageError) throw messageError;
  return data.id;
}

async function insertChart(ownerId: string): Promise<string> {
  const { data: profile, error: profileError } = await admin
    .from("birth_profiles")
    .select("id")
    .eq("owner_user_id", ownerId)
    .single();
  if (profileError) throw profileError;
  const { data, error } = await admin
    .from("charts")
    .insert({
      birth_profile_id: profile.id,
      house_system: "placidus",
      calculation_provider: "test",
      calculation_version: "1.0.0",
      input_hash: HASH,
      chart_json: { planets: [] },
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function insertAnalytics(event: string): Promise<string> {
  const userRef = hexRef();
  createdUserRefs.push(userRef);
  const { error } = await admin
    .from("analytics_events")
    .insert({ event, user_ref: userRef });
  if (error) throw error;
  return userRef;
}

async function count(
  table:
    | "profiles"
    | "birth_profiles"
    | "charts"
    | "consents"
    | "ai_threads"
    | "ai_messages"
    | "relationship_members"
    | "relationship_invites"
    | "ai_usage_events",
  column: string,
  value: string,
): Promise<number> {
  const { count: total, error } = await admin
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(column, value);
  expect(error).toBeNull();
  return total ?? 0;
}

let alice: TestUser;
let bob: TestUser;
let relationshipId: string;
let bobChartId: string;
let bobChartThreadId: string;
let bobRelationshipThreadId: string;
let aliceChartThreadId: string;
let aliceRelationshipThreadId: string;
let aliceUserRef: string;
let bobUserRef: string;

beforeAll(async () => {
  [alice, bob] = await Promise.all([
    setupUser("Alice Test"),
    setupUser("Bob Test"),
  ]);
  relationshipId = await connect(alice, bob);
});

afterAll(async () => {
  const errors: unknown[] = [];
  const record = (result: { error: unknown }) => {
    if (result.error) errors.push(result.error);
  };

  for (const id of createdRelationshipIds) {
    record(await admin.from("relationships").delete().eq("id", id));
  }
  for (const id of createdUserIds) {
    if (deletedUserIds.has(id)) continue;
    record(await admin.auth.admin.deleteUser(id));
  }
  if (createdUserRefs.length > 0) {
    record(
      await admin
        .from("analytics_events")
        .delete()
        .in("user_ref", createdUserRefs),
    );
  }
  const auditResourceIds = [...createdUserIds, ...createdRelationshipIds];
  record(
    await admin
      .from("audit_events")
      .delete()
      .in("resource_id", auditResourceIds),
  );
  if (createdAuditEventTypes.length > 0) {
    record(
      await admin
        .from("audit_events")
        .delete()
        .in("event_type", createdAuditEventTypes),
    );
  }

  if (errors.length > 0) {
    throw new Error(`Cleanup failed: ${JSON.stringify(errors)}`);
  }
});

// These suites run in order and build on each other's state.

describe("rls_audit", () => {
  it("lists no public table without row level security", async () => {
    const { data, error } = await admin.rpc("rls_audit");
    expect(error).toBeNull();
    expect(data, `Tables without RLS: ${(data ?? []).join(", ")}`).toEqual([]);
  });
});

describe("hardening privileges", () => {
  it("denies analytics events and the maintenance functions to clients", async () => {
    for (const client of [alice.client, anon]) {
      const select = await client.from("analytics_events").select("*").limit(1);
      expect(select.error?.code).toBe("42501");

      const insert = await client
        .from("analytics_events")
        .insert({ event: "registration", user_ref: hexRef() });
      expect(insert.error?.code).toBe("42501");

      const audit = await client.rpc("rls_audit");
      expect(audit.error?.code).toBe("42501");

      const purge = await client.rpc("purge_old_audit_events", {
        p_older_than: "400 days",
      });
      expect(purge.error?.code).toBe("42501");
    }
  });
});

describe("analytics_events", () => {
  it("accepts a valid event for the server", async () => {
    const userRef = hexRef();
    createdUserRefs.push(userRef);
    const { error } = await admin
      .from("analytics_events")
      .insert({ event: "chart_generated", user_ref: userRef });
    expect(error).toBeNull();

    const { data } = await admin
      .from("analytics_events")
      .select("event, user_ref")
      .eq("user_ref", userRef);
    expect(data).toEqual([{ event: "chart_generated", user_ref: userRef }]);
  });

  it("rejects an unknown event name and a user_ref that is not hex", async () => {
    const badEvent = await admin
      .from("analytics_events")
      .insert({ event: "page_view", user_ref: hexRef() });
    expect(badEvent.error?.code).toBe("23514");

    const nonHex = await admin
      .from("analytics_events")
      .insert({ event: "registration", user_ref: "z".repeat(64) });
    expect(nonHex.error?.code).toBe("23514");

    const tooShort = await admin
      .from("analytics_events")
      .insert({ event: "registration", user_ref: "ab12" });
    expect(tooShort.error?.code).toBe("23514");

    const upperCase = await admin
      .from("analytics_events")
      .insert({ event: "registration", user_ref: "A".repeat(64) });
    expect(upperCase.error?.code).toBe("23514");
  });
});

describe("purge_old_audit_events", () => {
  it("refuses a retention shorter than 30 days", async () => {
    const { error } = await admin.rpc("purge_old_audit_events", {
      p_older_than: "1 day",
    });
    expect(error?.message).toBe("retention_too_short");
  });

  it("refuses a null retention", async () => {
    const { error } = await admin.rpc("purge_old_audit_events", {
      p_older_than: null as unknown as string,
    });
    expect(error?.message).toBe("retention_too_short");
  });

  it("clears an account id left in a user-type row whose account is gone, and keeps the row", async () => {
    const goneId = randomUUID();
    const { data: inserted, error: insertError } = await admin
      .from("audit_events")
      .insert({
        event_type: "account.created",
        resource_type: "user",
        resource_id: goneId,
      })
      .select("id")
      .single();
    expect(insertError).toBeNull();
    const rowId = inserted!.id;
    try {
      const { error } = await admin.rpc("purge_old_audit_events", {
        p_older_than: "400 days",
      });
      expect(error).toBeNull();

      const { data: row } = await admin
        .from("audit_events")
        .select("resource_type, resource_id")
        .eq("id", rowId)
        .single();
      expect(row).toEqual({ resource_type: "user", resource_id: null });
    } finally {
      await admin.from("audit_events").delete().eq("id", rowId);
    }
  });

  it("clears an upper-case account id whose account is gone, and keeps an upper-case id of an account that exists", async () => {
    const goneId = randomUUID().toUpperCase();
    const liveId = alice.id.toUpperCase();
    // Each id is recorded as soon as its row exists, so the cleanup removes the
    // first row even if the second insert or an assertion fails.
    const rowIds: number[] = [];
    try {
      const { data: gone, error: goneError } = await admin
        .from("audit_events")
        .insert({
          event_type: "account.created",
          resource_type: "user",
          resource_id: goneId,
        })
        .select("id")
        .single();
      if (gone) rowIds.push(gone.id);
      expect(goneError).toBeNull();
      const { data: live, error: liveError } = await admin
        .from("audit_events")
        .insert({
          event_type: "account.created",
          resource_type: "user",
          resource_id: liveId,
        })
        .select("id")
        .single();
      if (live) rowIds.push(live.id);
      expect(liveError).toBeNull();

      const { error } = await admin.rpc("purge_old_audit_events", {
        p_older_than: "400 days",
      });
      expect(error).toBeNull();

      const { data: goneRow } = await admin
        .from("audit_events")
        .select("resource_type, resource_id")
        .eq("id", gone!.id)
        .single();
      expect(goneRow).toEqual({ resource_type: "user", resource_id: null });

      const { data: liveRow } = await admin
        .from("audit_events")
        .select("resource_type, resource_id")
        .eq("id", live!.id)
        .single();
      expect(liveRow).toEqual({ resource_type: "user", resource_id: liveId });
    } finally {
      if (rowIds.length > 0) {
        await admin.from("audit_events").delete().in("id", rowIds);
      }
    }
  });

  it("removes old events and keeps fresh ones", async () => {
    const freshType = `test.hardening.fresh.${randomUUID()}`;
    const oldType = `test.hardening.old.${randomUUID()}`;
    createdAuditEventTypes.push(freshType, oldType);

    // Two separate inserts: a bulk insert with different keys would send NULL
    // for the fresh row's created_at instead of its default.
    const { error: freshError } = await admin
      .from("audit_events")
      .insert({ event_type: freshType });
    expect(freshError).toBeNull();
    const { error: oldError } = await admin.from("audit_events").insert({
      event_type: oldType,
      created_at: new Date(Date.now() - 500 * DAY_MS).toISOString(),
    });
    expect(oldError).toBeNull();

    // This really purges: never point the suite at a production database.
    const { data, error } = await admin.rpc("purge_old_audit_events", {
      p_older_than: "400 days",
    });
    expect(error).toBeNull();
    expect(typeof data).toBe("number");
    expect(data).toBeGreaterThanOrEqual(1);

    const { data: fresh } = await admin
      .from("audit_events")
      .select("id")
      .eq("event_type", freshType);
    expect(fresh).toHaveLength(1);

    const { data: old } = await admin
      .from("audit_events")
      .select("id")
      .eq("event_type", oldType);
    expect(old).toEqual([]);
  });
});

describe("account deletion", () => {
  it("removes Alice's data and ends the relationship for Bob", async () => {
    // Seed everything the deletion has to deal with.
    const aliceChartId = await insertChart(alice.id);
    bobChartId = await insertChart(bob.id);
    aliceChartThreadId = await insertThread(alice.id, "Alice chart");
    aliceRelationshipThreadId = await insertThread(
      alice.id,
      "Alice and Bob",
      relationshipId,
    );
    bobChartThreadId = await insertThread(bob.id, "Bob chart");
    bobRelationshipThreadId = await insertThread(
      bob.id,
      "Bob and Alice",
      relationshipId,
    );

    const { error: synastryError } = await admin.from("synastry").insert({
      relationship_id: relationshipId,
      input_hash: HASH,
      facts_json: { aspects: [] },
      calculation_version: "1.0.0",
    });
    expect(synastryError).toBeNull();

    const claimId = randomUUID();
    const claim = await admin.rpc("claim_report_generation", {
      p_relationship_id: relationshipId,
      p_pending_cache_key: "a".repeat(64),
      p_claim_id: claimId,
    });
    expect(claim.data).toBe(true);
    const finish = await admin.rpc("finish_report_generation", {
      p_relationship_id: relationshipId,
      p_claim_id: claimId,
      p_success: true,
      p_report: {
        cache_key: "b".repeat(64),
        synastry_input_hash: HASH,
        facts_json: { aspects: [] },
        interpretation_json: { summary: "A steady pairing." },
        prompt_version: "report-v1",
        model: "test-model",
        generated_by: alice.id,
      },
    });
    expect(finish.data).toBe(true);

    const { error: usageError } = await admin.from("ai_usage_events").insert({
      user_id: alice.id,
      relationship_id: relationshipId,
      kind: "question",
      model: "test-model",
      prompt_version: "assistant-v1",
    });
    expect(usageError).toBeNull();

    const { error: consentError } = await admin.from("consents").insert({
      user_id: alice.id,
      consent_type: "terms",
      policy_version: POLICY,
    });
    expect(consentError).toBeNull();

    aliceUserRef = await insertAnalytics("registration");
    bobUserRef = await insertAnalytics("registration");

    // Alice's one invite (the accepted one she used to connect) must be
    // cleaned up with her account.
    expect(
      await count("relationship_invites", "inviter_user_id", alice.id),
    ).toBe(1);
    expect(await count("relationship_members", "user_id", alice.id)).toBe(1);
    expect(await count("charts", "id", aliceChartId)).toBe(1);

    await deleteUser(alice.id);

    // Alice's own data is gone.
    expect(await count("profiles", "id", alice.id)).toBe(0);
    expect(await count("birth_profiles", "owner_user_id", alice.id)).toBe(0);
    expect(await count("charts", "id", aliceChartId)).toBe(0);
    expect(await count("consents", "user_id", alice.id)).toBe(0);
    expect(await count("ai_threads", "owner_user_id", alice.id)).toBe(0);
    expect(await count("ai_messages", "thread_id", aliceChartThreadId)).toBe(0);
    expect(
      await count("ai_messages", "thread_id", aliceRelationshipThreadId),
    ).toBe(0);
    expect(await count("relationship_members", "user_id", alice.id)).toBe(0);
    expect(
      await count("relationship_invites", "inviter_user_id", alice.id),
    ).toBe(0);
    expect(await count("ai_usage_events", "user_id", alice.id)).toBe(0);

    // The relationship ended and Bob's side was closed.
    const { data: relationship } = await admin
      .from("relationships")
      .select("status, ended_by")
      .eq("id", relationshipId)
      .single();
    expect(relationship).toEqual({ status: "ended", ended_by: null });

    const { data: bobMember } = await admin
      .from("relationship_members")
      .select("left_at")
      .eq("relationship_id", relationshipId)
      .eq("user_id", bob.id)
      .single();
    expect(bobMember?.left_at).not.toBeNull();

    // Derived data of the relationship is gone, including Bob's thread.
    const { data: synastry } = await admin
      .from("synastry")
      .select("relationship_id")
      .eq("relationship_id", relationshipId);
    expect(synastry).toEqual([]);
    const { data: report } = await admin
      .from("compatibility_reports")
      .select("relationship_id")
      .eq("relationship_id", relationshipId);
    expect(report).toEqual([]);
    expect(await count("ai_threads", "id", bobRelationshipThreadId)).toBe(0);
    expect(
      await count("ai_messages", "thread_id", bobRelationshipThreadId),
    ).toBe(0);

    // Bob's own data is intact.
    expect(await count("profiles", "id", bob.id)).toBe(1);
    expect(await count("birth_profiles", "owner_user_id", bob.id)).toBe(1);
    expect(await count("charts", "id", bobChartId)).toBe(1);
    expect(await count("ai_threads", "id", bobChartThreadId)).toBe(1);
    expect(await count("ai_messages", "thread_id", bobChartThreadId)).toBe(1);

    // Bob is free to connect again.
    const { data: mine, error: mineError } = await bob.client.rpc(
      "get_my_relationship",
    );
    expect(mineError).toBeNull();
    expect(mine).toEqual([]);

    const { error: inviteError } = await bob.client.rpc("create_invite", {
      p_token_hash: newTokenHash(),
      p_policy_version: POLICY,
    });
    expect(inviteError).toBeNull();
  });

  it("leaves no audit event that points at the deleted account", async () => {
    const { data: created } = await admin
      .from("audit_events")
      .select("actor_user_id")
      .eq("event_type", "account.created")
      .eq("resource_id", alice.id);
    expect(created).toEqual([{ actor_user_id: null }]);

    const { data: actedBy } = await admin
      .from("audit_events")
      .select("id")
      .eq("actor_user_id", alice.id);
    expect(actedBy).toEqual([]);
  });

  // The app does this after the auth user is deleted (src/lib/account/
  // deletion.ts). This test calls the admin API directly, so it runs the same
  // update on a row of its own and checks the secret-key role may do it.
  it("lets the service role replace the account id in a user-type audit row", async () => {
    const goneId = randomUUID();
    const reference = hexRef();
    const { error: insertError } = await admin.from("audit_events").insert({
      actor_user_id: null,
      event_type: "account.created",
      resource_type: "user",
      resource_id: goneId,
      metadata: {},
    });
    expect(insertError).toBeNull();
    try {
      const { error } = await admin
        .from("audit_events")
        .update({ resource_id: reference })
        .eq("resource_type", "user")
        .eq("resource_id", goneId);
      expect(error).toBeNull();

      const { data: left } = await admin
        .from("audit_events")
        .select("id")
        .eq("resource_id", goneId);
      expect(left).toEqual([]);
      const { data: replaced } = await admin
        .from("audit_events")
        .select("resource_type")
        .eq("resource_id", reference);
      expect(replaced).toEqual([{ resource_type: "user" }]);
    } finally {
      await admin
        .from("audit_events")
        .delete()
        .in("resource_id", [goneId, reference]);
    }
  });
});

describe("orphan relationship cleanup", () => {
  it("removes the relationship once its last member is deleted", async () => {
    // Only the relationship row's removal is attributable to the orphan
    // trigger; the derived-data checks below were already true after the first
    // deletion and guard against regressions. Precondition: the ended
    // relationship is still around for Bob.
    const { data: before } = await admin
      .from("relationships")
      .select("id")
      .eq("id", relationshipId);
    expect(before).toEqual([{ id: relationshipId }]);

    await deleteUser(bob.id);

    const { data: relationship } = await admin
      .from("relationships")
      .select("id")
      .eq("id", relationshipId);
    expect(relationship).toEqual([]);

    expect(
      await count("relationship_members", "relationship_id", relationshipId),
    ).toBe(0);
    expect(await count("ai_threads", "relationship_id", relationshipId)).toBe(
      0,
    );
    const { data: synastry } = await admin
      .from("synastry")
      .select("relationship_id")
      .eq("relationship_id", relationshipId);
    expect(synastry).toEqual([]);
    const { data: reports } = await admin
      .from("compatibility_reports")
      .select("relationship_id")
      .eq("relationship_id", relationshipId);
    expect(reports).toEqual([]);

    // Bob's own rows are gone as well, including his chart and chart thread.
    expect(await count("profiles", "id", bob.id)).toBe(0);
    expect(await count("charts", "id", bobChartId)).toBe(0);
    expect(await count("ai_threads", "id", bobChartThreadId)).toBe(0);
    expect(await count("relationship_invites", "inviter_user_id", bob.id)).toBe(
      0,
    );
  });
});

describe("analytics events after account deletion", () => {
  it("are not cascaded away with the accounts", async () => {
    const { data, error } = await admin
      .from("analytics_events")
      .select("user_ref")
      .in("user_ref", [aliceUserRef, bobUserRef]);
    expect(error).toBeNull();
    expect(data?.map((row) => row.user_ref).sort()).toEqual(
      [aliceUserRef, bobUserRef].sort(),
    );
  });
});
