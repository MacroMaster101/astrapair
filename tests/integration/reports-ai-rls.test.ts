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
const createdUserIds: string[] = [];
const createdRelationshipIds: string[] = [];

const POLICY = "test-v1";
const PENDING_KEY = "a".repeat(64);
const READY_KEY = "b".repeat(64);
const HASH = "c".repeat(64);

async function setupUser(displayName: string): Promise<TestUser> {
  const email = `reports-ai-rls-${randomUUID()}@example.test`;
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

async function connect(inviter: TestUser, invitee: TestUser): Promise<string> {
  const hash = createHash("sha256")
    .update(randomBytes(32).toString("base64url"))
    .digest("hex");
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

async function insertSynastry(relationshipId: string) {
  const { error } = await admin.from("synastry").insert({
    relationship_id: relationshipId,
    input_hash: HASH,
    facts_json: { aspects: [] },
    calculation_version: "1.0.0",
  });
  expect(error).toBeNull();
}

let alice: TestUser;
let bob: TestUser;
let carol: TestUser;

// Shared across the ordered tests below: the Alice/Bob relationship story.
let relationshipId: string;
let chartThreadId: string;
// Claim nonce for the first report generation.
const firstClaim = randomUUID();
let relationshipThreadId: string;

beforeAll(async () => {
  [alice, bob, carol] = await Promise.all([
    setupUser("Alice Test"),
    setupUser("Bob Test"),
    setupUser("Carol Test"),
  ]);
  relationshipId = await connect(alice, bob);
});

afterAll(async () => {
  // Relationships survive user deletion (created_by is set null), so remove
  // them explicitly; that cascades to members, reports and relationship threads.
  await Promise.all(
    createdRelationshipIds.map((id) =>
      admin.from("relationships").delete().eq("id", id),
    ),
  );
  await Promise.all(
    createdUserIds.map((id) => admin.auth.admin.deleteUser(id)),
  );
});

// These suites run in order and build on each other's state.

describe("report generation claim", () => {
  it("lets the server claim once and hides the report from outsiders", async () => {
    const first = await admin.rpc("claim_report_generation", {
      p_relationship_id: relationshipId,
      p_pending_cache_key: PENDING_KEY,
      p_claim_id: firstClaim,
    });
    expect(first.error).toBeNull();
    expect(first.data).toBe(true);

    const second = await admin.rpc("claim_report_generation", {
      p_relationship_id: relationshipId,
      p_pending_cache_key: "d".repeat(64),
      p_claim_id: randomUUID(),
    });
    expect(second.error).toBeNull();
    expect(second.data).toBe(false);

    for (const user of [alice, bob]) {
      const { data } = await user.client
        .from("compatibility_reports")
        .select("relationship_id, status")
        .eq("relationship_id", relationshipId);
      expect(data).toEqual([
        { relationship_id: relationshipId, status: "generating" },
      ]);
    }

    const { data: carolRows } = await carol.client
      .from("compatibility_reports")
      .select("*")
      .eq("relationship_id", relationshipId);
    expect(carolRows).toEqual([]);
  });

  it("is not callable by signed-in users", async () => {
    const claim = await alice.client.rpc("claim_report_generation", {
      p_relationship_id: relationshipId,
      p_pending_cache_key: PENDING_KEY,
      p_claim_id: randomUUID(),
    });
    expect(claim.error?.code).toBe("42501");

    const finish = await alice.client.rpc("finish_report_generation", {
      p_relationship_id: relationshipId,
      p_claim_id: firstClaim,
      p_success: true,
      p_report: {},
    });
    expect(finish.error?.code).toBe("42501");
  });

  it("rejects a claim without a claim id", async () => {
    const { error } = await admin.rpc("claim_report_generation", {
      p_relationship_id: relationshipId,
      p_pending_cache_key: PENDING_KEY,
      p_claim_id: null as unknown as string,
    });
    expect(error?.message).toBe("invalid_claim");
  });
});

describe("report generation finish", () => {
  const report = {
    cache_key: READY_KEY,
    synastry_input_hash: HASH,
    facts_json: { aspects: [] },
    interpretation_json: { summary: "A steady pairing." },
    prompt_version: "report-v1",
    model: "test-model",
  };

  async function reportRow() {
    const { data } = await admin
      .from("compatibility_reports")
      .select("*")
      .eq("relationship_id", relationshipId)
      .single();
    return data!;
  }

  it("changes nothing when the claim id does not match", async () => {
    const { data, error } = await admin.rpc("finish_report_generation", {
      p_relationship_id: relationshipId,
      p_claim_id: randomUUID(),
      p_success: true,
      p_report: { ...report, generated_by: alice.id },
    });
    expect(error).toBeNull();
    expect(data).toBe(false);

    expect(await reportRow()).toMatchObject({
      status: "generating",
      cache_key: null,
      interpretation_json: null,
      pending_cache_key: PENDING_KEY,
      claim_id: firstClaim,
      generated_by: null,
    });
  });

  it("stores the report when the claim id matches", async () => {
    const { data, error } = await admin.rpc("finish_report_generation", {
      p_relationship_id: relationshipId,
      p_claim_id: firstClaim,
      p_success: true,
      p_report: { ...report, generated_by: alice.id },
    });
    expect(error).toBeNull();
    expect(data).toBe(true);

    const row = await reportRow();
    expect(row).toMatchObject({
      status: "ready",
      cache_key: READY_KEY,
      pending_cache_key: null,
      claim_id: null,
      generated_by: alice.id,
      synastry_input_hash: HASH,
      facts_json: { aspects: [] },
      interpretation_json: { summary: "A steady pairing." },
      prompt_version: "report-v1",
      model: "test-model",
    });
    expect(row.completed_at).not.toBeNull();
  });

  it("keeps the previous report when a refresh fails", async () => {
    const claimId = randomUUID();
    const claim = await admin.rpc("claim_report_generation", {
      p_relationship_id: relationshipId,
      p_pending_cache_key: "f".repeat(64),
      p_claim_id: claimId,
    });
    expect(claim.data).toBe(true);
    expect(await reportRow()).toMatchObject({
      status: "generating",
      cache_key: READY_KEY,
      generated_by: alice.id,
    });

    const { data, error } = await admin.rpc("finish_report_generation", {
      p_relationship_id: relationshipId,
      p_claim_id: claimId,
      p_success: false,
      p_report: {},
    });
    expect(error).toBeNull();
    expect(data).toBe(true);
    expect(await reportRow()).toMatchObject({
      status: "ready",
      cache_key: READY_KEY,
      interpretation_json: { summary: "A steady pairing." },
      pending_cache_key: null,
      claim_id: null,
      generated_by: alice.id,
    });
  });

  it("keeps the existing generator when the payload names none", async () => {
    const claimId = randomUUID();
    const claim = await admin.rpc("claim_report_generation", {
      p_relationship_id: relationshipId,
      p_pending_cache_key: "9".repeat(64),
      p_claim_id: claimId,
    });
    expect(claim.data).toBe(true);

    const { data, error } = await admin.rpc("finish_report_generation", {
      p_relationship_id: relationshipId,
      p_claim_id: claimId,
      p_success: true,
      p_report: { ...report, cache_key: "9".repeat(64) },
    });
    expect(error).toBeNull();
    expect(data).toBe(true);
    expect(await reportRow()).toMatchObject({
      status: "ready",
      cache_key: "9".repeat(64),
      generated_by: alice.id,
    });
  });

  it("lets a stale claim be taken over and ignores the old claimant", async () => {
    const oldClaim = randomUUID();
    const newClaim = randomUUID();
    const first = await admin.rpc("claim_report_generation", {
      p_relationship_id: relationshipId,
      p_pending_cache_key: PENDING_KEY,
      p_claim_id: oldClaim,
    });
    expect(first.data).toBe(true);

    // A live claim blocks a second one.
    const blocked = await admin.rpc("claim_report_generation", {
      p_relationship_id: relationshipId,
      p_pending_cache_key: PENDING_KEY,
      p_claim_id: newClaim,
    });
    expect(blocked.data).toBe(false);

    const { error: ageError } = await admin
      .from("compatibility_reports")
      .update({
        generation_started_at: new Date(Date.now() - 11 * 60_000).toISOString(),
      })
      .eq("relationship_id", relationshipId);
    expect(ageError).toBeNull();

    const takeover = await admin.rpc("claim_report_generation", {
      p_relationship_id: relationshipId,
      p_pending_cache_key: PENDING_KEY,
      p_claim_id: newClaim,
    });
    expect(takeover.data).toBe(true);

    const stale = await admin.rpc("finish_report_generation", {
      p_relationship_id: relationshipId,
      p_claim_id: oldClaim,
      p_success: false,
      p_report: {},
    });
    expect(stale.error).toBeNull();
    expect(stale.data).toBe(false);
    expect(await reportRow()).toMatchObject({
      status: "generating",
      claim_id: newClaim,
    });

    const current = await admin.rpc("finish_report_generation", {
      p_relationship_id: relationshipId,
      p_claim_id: newClaim,
      p_success: false,
      p_report: {},
    });
    expect(current.data).toBe(true);
    expect((await reportRow()).status).toBe("ready");
  });

  it("marks a first generation as failed when there is no previous report", async () => {
    const { error: deleteError } = await admin
      .from("compatibility_reports")
      .delete()
      .eq("relationship_id", relationshipId);
    expect(deleteError).toBeNull();

    const claimId = randomUUID();
    const claim = await admin.rpc("claim_report_generation", {
      p_relationship_id: relationshipId,
      p_pending_cache_key: PENDING_KEY,
      p_claim_id: claimId,
    });
    expect(claim.data).toBe(true);

    const { data, error } = await admin.rpc("finish_report_generation", {
      p_relationship_id: relationshipId,
      p_claim_id: claimId,
      p_success: false,
      p_report: {},
    });
    expect(error).toBeNull();
    expect(data).toBe(true);
    expect(await reportRow()).toMatchObject({
      status: "failed",
      interpretation_json: null,
      pending_cache_key: null,
      claim_id: null,
    });
  });
});

describe("client write access", () => {
  it("is denied on reports, threads and messages, and usage events are unreadable", async () => {
    const { data: thread, error: seedError } = await admin
      .from("ai_threads")
      .insert({
        owner_user_id: alice.id,
        thread_type: "chart",
        title: "Seed thread",
      })
      .select("id")
      .single();
    expect(seedError).toBeNull();
    const seedThreadId = thread!.id;

    const results = await Promise.all([
      alice.client.from("compatibility_reports").insert({
        relationship_id: relationshipId,
        status: "failed",
      }),
      alice.client
        .from("compatibility_reports")
        .update({ model: "forged" })
        .eq("relationship_id", relationshipId),
      alice.client
        .from("compatibility_reports")
        .delete()
        .eq("relationship_id", relationshipId),
      alice.client.from("ai_threads").insert({
        owner_user_id: alice.id,
        thread_type: "chart",
        title: "Forged",
      }),
      alice.client
        .from("ai_threads")
        .update({ title: "Forged" })
        .eq("id", seedThreadId),
      alice.client.from("ai_threads").delete().eq("id", seedThreadId),
      alice.client.from("ai_messages").insert({
        thread_id: seedThreadId,
        role: "user",
        content: "Forged",
      }),
      alice.client
        .from("ai_messages")
        .update({ content: "Forged" })
        .eq("thread_id", seedThreadId),
      alice.client.from("ai_messages").delete().eq("thread_id", seedThreadId),
      alice.client.from("ai_usage_events").select("*").limit(1),
    ]);
    for (const result of results) {
      expect(result.error?.code).toBe("42501");
    }

    // The seed thread survived the attempted delete.
    const { data: still } = await admin
      .from("ai_threads")
      .select("id")
      .eq("id", seedThreadId);
    expect(still).toHaveLength(1);
    await admin.from("ai_threads").delete().eq("id", seedThreadId);
  });
});

describe("threads and messages", () => {
  it("are visible to their owner only", async () => {
    const { data: chart, error: chartError } = await admin
      .from("ai_threads")
      .insert({
        owner_user_id: alice.id,
        thread_type: "chart",
        title: "About my chart",
      })
      .select("id")
      .single();
    expect(chartError).toBeNull();
    chartThreadId = chart!.id;

    const { data: rel, error: relError } = await admin
      .from("ai_threads")
      .insert({
        owner_user_id: alice.id,
        relationship_id: relationshipId,
        thread_type: "relationship",
        title: "About us",
      })
      .select("id")
      .single();
    expect(relError).toBeNull();
    relationshipThreadId = rel!.id;

    const { error: messageError } = await admin.from("ai_messages").insert([
      { thread_id: chartThreadId, role: "user", content: "Chart question" },
      { thread_id: relationshipThreadId, role: "user", content: "Us question" },
      {
        thread_id: relationshipThreadId,
        role: "assistant",
        content: "Us answer",
        model: "test-model",
        prompt_version: "assistant-v1",
        input_tokens: 10,
        output_tokens: 20,
      },
    ]);
    expect(messageError).toBeNull();

    const { data: aliceThreads } = await alice.client
      .from("ai_threads")
      .select("id")
      .in("id", [chartThreadId, relationshipThreadId]);
    expect(aliceThreads?.map((t) => t.id).sort()).toEqual(
      [chartThreadId, relationshipThreadId].sort(),
    );

    const { data: aliceMessages } = await alice.client
      .from("ai_messages")
      .select("thread_id")
      .in("thread_id", [chartThreadId, relationshipThreadId]);
    expect(aliceMessages).toHaveLength(3);

    // Bob is in the relationship but does not own either thread.
    for (const other of [bob, carol]) {
      const { data: threads } = await other.client
        .from("ai_threads")
        .select("id")
        .in("id", [chartThreadId, relationshipThreadId]);
      expect(threads).toEqual([]);

      const { data: messages } = await other.client
        .from("ai_messages")
        .select("id")
        .in("thread_id", [chartThreadId, relationshipThreadId]);
      expect(messages).toEqual([]);
    }
  });
});

describe("end_relationship", () => {
  it("removes the report, synastry and relationship thread but keeps chart threads", async () => {
    await insertSynastry(relationshipId);

    const { error } = await bob.client.rpc("end_relationship", {
      p_relationship_id: relationshipId,
    });
    expect(error).toBeNull();

    const { data: reports } = await admin
      .from("compatibility_reports")
      .select("relationship_id")
      .eq("relationship_id", relationshipId);
    expect(reports).toEqual([]);

    const { data: synastry } = await admin
      .from("synastry")
      .select("relationship_id")
      .eq("relationship_id", relationshipId);
    expect(synastry).toEqual([]);

    const { data: relThread } = await admin
      .from("ai_threads")
      .select("id")
      .eq("id", relationshipThreadId);
    expect(relThread).toEqual([]);

    const { data: relMessages } = await admin
      .from("ai_messages")
      .select("id")
      .eq("thread_id", relationshipThreadId);
    expect(relMessages).toEqual([]);

    const { data: chartThread } = await alice.client
      .from("ai_threads")
      .select("id")
      .eq("id", chartThreadId);
    expect(chartThread).toEqual([{ id: chartThreadId }]);
    const { data: chartMessages } = await alice.client
      .from("ai_messages")
      .select("id")
      .eq("thread_id", chartThreadId);
    expect(chartMessages).toHaveLength(1);
  });

  it("rejects new derived rows for the ended relationship", async () => {
    const thread = await admin.from("ai_threads").insert({
      owner_user_id: alice.id,
      relationship_id: relationshipId,
      thread_type: "relationship",
      title: "After the end",
    });
    expect(thread.error?.code).toBe("AP001");
    expect(thread.error?.message).toBe("relationship_not_active");

    const report = await admin.from("compatibility_reports").insert({
      relationship_id: relationshipId,
      status: "generating",
      pending_cache_key: PENDING_KEY,
      claim_id: randomUUID(),
    });
    expect(report.error?.code).toBe("AP001");
    expect(report.error?.message).toBe("relationship_not_active");

    const claim = await admin.rpc("claim_report_generation", {
      p_relationship_id: relationshipId,
      p_pending_cache_key: PENDING_KEY,
      p_claim_id: randomUUID(),
    });
    expect(claim.error?.code).toBe("AP001");
    expect(claim.error?.message).toBe("relationship_not_active");

    const synastry = await admin.from("synastry").insert({
      relationship_id: relationshipId,
      input_hash: HASH,
      facts_json: { aspects: [] },
      calculation_version: "1.0.0",
    });
    expect(synastry.error?.code).toBe("AP001");
    expect(synastry.error?.message).toBe("relationship_not_active");

    // Chart threads do not depend on a relationship.
    const chart = await admin.from("ai_threads").insert({
      owner_user_id: alice.id,
      thread_type: "chart",
      title: "Still allowed",
    });
    expect(chart.error).toBeNull();
  });
});

describe("birth profile deletion", () => {
  it("removes the owner's relationship synastry and report", async () => {
    const [dave, erin] = await Promise.all([
      setupUser("Dave Test"),
      setupUser("Erin Test"),
    ]);
    const pairId = await connect(dave, erin);
    await insertSynastry(pairId);

    const claim = await admin.rpc("claim_report_generation", {
      p_relationship_id: pairId,
      p_pending_cache_key: PENDING_KEY,
      p_claim_id: randomUUID(),
    });
    expect(claim.data).toBe(true);

    const { error } = await admin
      .from("birth_profiles")
      .delete()
      .eq("owner_user_id", dave.id);
    expect(error).toBeNull();

    const { data: synastry } = await admin
      .from("synastry")
      .select("relationship_id")
      .eq("relationship_id", pairId);
    expect(synastry).toEqual([]);

    const { data: reports } = await admin
      .from("compatibility_reports")
      .select("relationship_id")
      .eq("relationship_id", pairId);
    expect(reports).toEqual([]);

    // The relationship itself is untouched.
    const { data: rel } = await admin
      .from("relationships")
      .select("status")
      .eq("id", pairId)
      .single();
    expect(rel).toEqual({ status: "active" });
  });
});
