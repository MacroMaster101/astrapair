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
const createdRelationshipIds: string[] = [];

const POLICY = "test-v1";
// Alice's invite uses a different version so a swap of the two consent
// versions in accept_invite would be caught.
const INVITER_POLICY = "test-inviter";
const BIRTH_DATA = /1990|Colombo|6\.93|79\.84|Asia\/Colombo/;

async function setupUser(
  opts: { onboarded: boolean; withBirthProfile: boolean },
  displayName: string,
): Promise<TestUser> {
  const email = `partner-rls-${randomUUID()}@example.test`;
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

  if (opts.onboarded) {
    const { error: onboardError } = await admin
      .from("profiles")
      .update({ onboarded_at: new Date().toISOString() })
      .eq("id", id);
    if (onboardError) throw onboardError;
  }
  if (opts.withBirthProfile) {
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
  }
  return { id, client };
}

function newTokenHash(): string {
  return createHash("sha256")
    .update(randomBytes(32).toString("base64url"))
    .digest("hex");
}

async function createInvite(
  user: TestUser,
  policyVersion: string = POLICY,
): Promise<string> {
  const hash = newTokenHash();
  const { error } = await user.client.rpc("create_invite", {
    p_token_hash: hash,
    p_policy_version: policyVersion,
  });
  if (error) throw error;
  return hash;
}

async function previewState(
  client: SupabaseClient<Database>,
  hash: string,
): Promise<string | undefined> {
  const { data } = await client.rpc("get_invite_preview", {
    p_token_hash: hash,
  });
  return data?.[0]?.state;
}

let notOnboarded: TestUser;
let noProfile: TestUser;
let alice: TestUser;
let bob: TestUser;
let carol: TestUser;
let dave: TestUser;
let erin: TestUser;
let frank: TestUser;

// Shared across the ordered tests below: the Alice/Bob relationship story.
let aliceFirstHash: string;
let aliceHash: string;
let relationshipId: string;

beforeAll(async () => {
  const full = { onboarded: true, withBirthProfile: true };
  [notOnboarded, noProfile, alice, bob, carol, dave, erin, frank] =
    await Promise.all([
      setupUser({ onboarded: false, withBirthProfile: true }, "Not Onboarded"),
      setupUser({ onboarded: true, withBirthProfile: false }, "No Profile"),
      setupUser(full, "Alice Test"),
      setupUser(full, "Bob Test"),
      setupUser(full, "Carol Test"),
      setupUser(full, "Dave Test"),
      setupUser(full, "Erin Test"),
      setupUser(full, "Frank Test"),
    ]);
});

afterAll(async () => {
  // Relationships survive user deletion (created_by is set null), so remove
  // them explicitly; that cascades to members, synastry and partner consents.
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

describe("create_invite", () => {
  it("rejects a user who has not finished onboarding", async () => {
    const { error } = await notOnboarded.client.rpc("create_invite", {
      p_token_hash: newTokenHash(),
      p_policy_version: POLICY,
    });
    expect(error?.message).toBe("not_onboarded");
  });

  it("rejects an onboarded user with no birth profile", async () => {
    const { error } = await noProfile.client.rpc("create_invite", {
      p_token_hash: newTokenHash(),
      p_policy_version: POLICY,
    });
    expect(error?.message).toBe("no_birth_profile");
  });

  it("creates an invite that lasts about 7 days", async () => {
    aliceFirstHash = await createInvite(alice);

    const { data, error } = await alice.client.rpc("get_my_pending_invite");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    const days =
      (new Date(data![0].expires_at).getTime() - Date.now()) / 86_400_000;
    // Loose bounds tolerate clock skew between the test runner and the database.
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it("revokes the previous pending invite when a new one is created", async () => {
    aliceHash = await createInvite(alice, INVITER_POLICY);

    expect(await previewState(anon, aliceFirstHash)).toBe("revoked");
    expect(await previewState(anon, aliceHash)).toBe("valid");

    const { data } = await alice.client.rpc("get_my_pending_invite");
    expect(data).toHaveLength(1);
  });
});

describe("get_invite_preview", () => {
  it("shows an anonymous visitor the inviter's name for a valid invite", async () => {
    const { data, error } = await anon.rpc("get_invite_preview", {
      p_token_hash: aliceHash,
    });
    expect(error).toBeNull();
    expect(data).toEqual([
      { inviter_name: "Alice Test", state: "valid", is_own: false },
    ]);
  });

  it("flags the inviter's own link", async () => {
    const { data } = await alice.client.rpc("get_invite_preview", {
      p_token_hash: aliceHash,
    });
    expect(data).toEqual([
      { inviter_name: "Alice Test", state: "valid", is_own: true },
    ]);
  });

  it("reports not_found with no name for an unknown token", async () => {
    const { data, error } = await anon.rpc("get_invite_preview", {
      p_token_hash: newTokenHash(),
    });
    expect(error).toBeNull();
    expect(data).toEqual([
      { inviter_name: null, state: "not_found", is_own: false },
    ]);
  });

  it("hides the inviter's name once an invite is no longer valid", async () => {
    const { data } = await anon.rpc("get_invite_preview", {
      p_token_hash: aliceFirstHash,
    });
    expect(data).toEqual([
      { inviter_name: null, state: "revoked", is_own: false },
    ]);
  });
});

describe("relationship_invites table", () => {
  it("is not selectable by users or anonymous visitors", async () => {
    for (const client of [alice.client, bob.client, anon]) {
      const { error } = await client
        .from("relationship_invites")
        .select("*")
        .limit(1);
      expect(error?.code).toBe("42501");
    }
  });
});

describe("accept_invite", () => {
  it("connects Bob and Alice, and only they can see the relationship", async () => {
    const { data, error } = await bob.client.rpc("accept_invite", {
      p_token_hash: aliceHash,
      p_policy_version: POLICY,
    });
    expect(error).toBeNull();
    expect(data).toEqual(expect.any(String));
    relationshipId = data!;
    createdRelationshipIds.push(relationshipId);

    for (const user of [alice, bob]) {
      const { data: rels } = await user.client
        .from("relationships")
        .select("id, status");
      expect(rels).toEqual([{ id: relationshipId, status: "active" }]);

      const { data: members } = await user.client
        .from("relationship_members")
        .select("user_id")
        .eq("relationship_id", relationshipId);
      expect(members?.map((m) => m.user_id).sort()).toEqual(
        [alice.id, bob.id].sort(),
      );
    }

    const { data: carolRels } = await carol.client
      .from("relationships")
      .select("*");
    expect(carolRels).toEqual([]);
    const { data: carolMembers } = await carol.client
      .from("relationship_members")
      .select("*")
      .eq("relationship_id", relationshipId);
    expect(carolMembers).toEqual([]);
  });

  it("tells each partner about the other and nobody else", async () => {
    const { data: forAlice } = await alice.client.rpc("get_my_relationship");
    expect(forAlice).toHaveLength(1);
    expect(forAlice![0]).toMatchObject({
      relationship_id: relationshipId,
      partner_user_id: bob.id,
      partner_display_name: "Bob Test",
    });

    const { data: forBob } = await bob.client.rpc("get_my_relationship");
    expect(forBob).toHaveLength(1);
    expect(forBob![0]).toMatchObject({
      relationship_id: relationshipId,
      partner_user_id: alice.id,
      partner_display_name: "Alice Test",
    });

    const { data: forCarol } = await carol.client.rpc("get_my_relationship");
    expect(forCarol).toEqual([]);
  });

  it("does not allow the same token to be used twice", async () => {
    const { error } = await carol.client.rpc("accept_invite", {
      p_token_hash: aliceHash,
      p_policy_version: POLICY,
    });
    expect(error?.message).toBe("invite_used");
  });

  it("rejects the inviter accepting their own invite", async () => {
    const hash = await createInvite(dave);
    const { error } = await dave.client.rpc("accept_invite", {
      p_token_hash: hash,
      p_policy_version: POLICY,
    });
    expect(error?.message).toBe("self_invite");
  });

  it("allows only one active connection per user", async () => {
    const hash = await createInvite(dave);

    const { error } = await bob.client.rpc("accept_invite", {
      p_token_hash: hash,
      p_policy_version: POLICY,
    });
    expect(error?.message).toBe("already_connected");
  });

  it("rejects an expired invite", async () => {
    const hash = await createInvite(erin);
    const { error: expireError } = await admin
      .from("relationship_invites")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("token_hash", hash);
    expect(expireError).toBeNull();

    const { error } = await frank.client.rpc("accept_invite", {
      p_token_hash: hash,
      p_policy_version: POLICY,
    });
    expect(error?.message).toBe("invite_expired");
    expect(await previewState(anon, hash)).toBe("expired");
  });
});

describe("decline_invite", () => {
  it("marks the invite used and creates no relationship", async () => {
    const hash = await createInvite(erin);

    const { error } = await frank.client.rpc("decline_invite", {
      p_token_hash: hash,
    });
    expect(error).toBeNull();
    expect(await previewState(anon, hash)).toBe("used");

    const { data: mine } = await frank.client.rpc("get_my_relationship");
    expect(mine).toEqual([]);
    const { data: memberships } = await admin
      .from("relationship_members")
      .select("user_id")
      .eq("user_id", frank.id);
    expect(memberships).toEqual([]);

    const { error: replay } = await frank.client.rpc("accept_invite", {
      p_token_hash: hash,
      p_policy_version: POLICY,
    });
    expect(replay?.message).toBe("invite_used");
  });
});

describe("partner_sharing consents", () => {
  it("records one consent per partner, scoped to the relationship", async () => {
    const { data, error } = await admin
      .from("consents")
      .select("user_id, consent_type, policy_version, revoked_at")
      .eq("relationship_id", relationshipId);
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data!.every((c) => c.consent_type === "partner_sharing")).toBe(true);
    expect(data!.every((c) => c.revoked_at === null)).toBe(true);
    expect(data!.map((c) => c.user_id).sort()).toEqual(
      [alice.id, bob.id].sort(),
    );
    const versionFor = (id: string) =>
      data!.find((c) => c.user_id === id)?.policy_version;
    expect(versionFor(alice.id)).toBe(INVITER_POLICY);
    expect(versionFor(bob.id)).toBe(POLICY);
  });
});

describe("synastry RLS", () => {
  it("is readable by active members only and never client-writable", async () => {
    const { error: insertError } = await admin.from("synastry").insert({
      relationship_id: relationshipId,
      input_hash: "d".repeat(64),
      facts_json: { aspects: [] },
      calculation_version: "1.0.0",
    });
    expect(insertError).toBeNull();

    for (const user of [alice, bob]) {
      const { data } = await user.client
        .from("synastry")
        .select("relationship_id")
        .eq("relationship_id", relationshipId);
      expect(data).toEqual([{ relationship_id: relationshipId }]);
    }
    const { data: carolRows } = await carol.client
      .from("synastry")
      .select("*")
      .eq("relationship_id", relationshipId);
    expect(carolRows).toEqual([]);

    const insert = await alice.client.from("synastry").insert({
      relationship_id: relationshipId,
      input_hash: "e".repeat(64),
      facts_json: {},
      calculation_version: "1.0.0",
    });
    expect(insert.error?.code).toBe("42501");

    const update = await alice.client
      .from("synastry")
      .update({ calculation_version: "forged" })
      .eq("relationship_id", relationshipId);
    expect(update.error?.code).toBe("42501");
  });
});

describe("charts", () => {
  it("are no longer client-writable", async () => {
    const { data: profile } = await admin
      .from("birth_profiles")
      .select("id")
      .eq("owner_user_id", alice.id)
      .single();
    const { error } = await alice.client.from("charts").insert({
      birth_profile_id: profile!.id,
      calculation_provider: "x",
      calculation_version: "x",
      input_hash: "f".repeat(64),
      chart_json: { forged: true },
    });
    expect(error?.code).toBe("42501");
  });
});

describe("end_relationship", () => {
  it("refuses a non-member", async () => {
    const { error } = await carol.client.rpc("end_relationship", {
      p_relationship_id: relationshipId,
    });
    expect(error?.message).toBe("not_a_member");
  });

  it("ends the connection and removes shared data", async () => {
    const { error } = await bob.client.rpc("end_relationship", {
      p_relationship_id: relationshipId,
    });
    expect(error).toBeNull();

    const { data: synastry } = await admin
      .from("synastry")
      .select("relationship_id")
      .eq("relationship_id", relationshipId);
    expect(synastry).toEqual([]);

    const { data: consents } = await admin
      .from("consents")
      .select("revoked_at")
      .eq("relationship_id", relationshipId);
    expect(consents).toHaveLength(2);
    expect(consents!.every((c) => c.revoked_at !== null)).toBe(true);

    const { data: members } = await admin
      .from("relationship_members")
      .select("left_at")
      .eq("relationship_id", relationshipId);
    expect(members).toHaveLength(2);
    expect(members!.every((m) => m.left_at !== null)).toBe(true);

    const { data: rel } = await admin
      .from("relationships")
      .select("status, ended_by")
      .eq("id", relationshipId)
      .single();
    expect(rel).toEqual({ status: "ended", ended_by: bob.id });

    for (const user of [alice, bob]) {
      const { data } = await user.client.rpc("get_my_relationship");
      expect(data).toEqual([]);
    }

    // Former members no longer see the ended relationship or its members.
    for (const user of [alice, bob]) {
      const { data: rels } = await user.client
        .from("relationships")
        .select("id")
        .eq("id", relationshipId);
      expect(rels).toEqual([]);
      const { data: members } = await user.client
        .from("relationship_members")
        .select("user_id")
        .eq("relationship_id", relationshipId);
      expect(members).toEqual([]);
    }
  });

  it("does not allow synastry for an ended relationship", async () => {
    const { error } = await admin.from("synastry").insert({
      relationship_id: relationshipId,
      input_hash: "d".repeat(64),
      facts_json: { aspects: [] },
      calculation_version: "1.0.0",
    });
    expect(error?.message).toBe("relationship_not_active");

    for (const user of [alice, bob]) {
      const { data } = await user.client
        .from("synastry")
        .select("relationship_id")
        .eq("relationship_id", relationshipId);
      expect(data).toEqual([]);
    }
  });

  it("lets a former partner invite again", async () => {
    const { error } = await alice.client.rpc("create_invite", {
      p_token_hash: newTokenHash(),
      p_policy_version: POLICY,
    });
    expect(error).toBeNull();
  });
});

describe("audit events", () => {
  it("record invite and relationship changes with ids only", async () => {
    const { data: created } = await admin
      .from("audit_events")
      .select("resource_type, resource_id, metadata")
      .eq("actor_user_id", alice.id)
      .eq("event_type", "invite.created");
    expect(created!.length).toBeGreaterThanOrEqual(1);

    const { data: relCreated } = await admin
      .from("audit_events")
      .select("resource_type, resource_id, metadata")
      .eq("actor_user_id", bob.id)
      .eq("event_type", "relationship.created");
    expect(relCreated).toEqual([
      {
        resource_type: "relationship",
        resource_id: relationshipId,
        metadata: {},
      },
    ]);

    const { data: relEnded } = await admin
      .from("audit_events")
      .select("resource_type, resource_id, metadata")
      .eq("actor_user_id", bob.id)
      .eq("event_type", "relationship.ended");
    expect(relEnded).toEqual([
      {
        resource_type: "relationship",
        resource_id: relationshipId,
        metadata: {},
      },
    ]);

    for (const row of [...created!, ...relCreated!, ...relEnded!]) {
      expect(JSON.stringify(row.metadata)).not.toMatch(BIRTH_DATA);
    }
  });
});

describe("account deletion", () => {
  it("ends the relationship and frees the remaining partner", async () => {
    const full = { onboarded: true, withBirthProfile: true };
    const [gina, hank] = await Promise.all([
      setupUser(full, "Gina Test"),
      setupUser(full, "Hank Test"),
    ]);

    const hash = await createInvite(gina);
    const { data: rid, error: acceptError } = await hank.client.rpc(
      "accept_invite",
      { p_token_hash: hash, p_policy_version: POLICY },
    );
    expect(acceptError).toBeNull();
    const ginaHankId = rid!;
    createdRelationshipIds.push(ginaHankId);

    const { error: synastryError } = await admin.from("synastry").insert({
      relationship_id: ginaHankId,
      input_hash: "a".repeat(64),
      facts_json: { aspects: [] },
      calculation_version: "1.0.0",
    });
    expect(synastryError).toBeNull();

    // Deleting the account cascades the member row and fires the trigger.
    const { error: deleteError } = await admin.auth.admin.deleteUser(hank.id);
    expect(deleteError).toBeNull();
    createdUserIds.splice(createdUserIds.indexOf(hank.id), 1);

    const { data: rel } = await admin
      .from("relationships")
      .select("status, ended_by")
      .eq("id", ginaHankId)
      .single();
    expect(rel).toEqual({ status: "ended", ended_by: null });

    const { data: members } = await admin
      .from("relationship_members")
      .select("user_id, left_at")
      .eq("relationship_id", ginaHankId);
    expect(members).toHaveLength(1);
    expect(members![0].user_id).toBe(gina.id);
    expect(members![0].left_at).not.toBeNull();

    const { data: synastry } = await admin
      .from("synastry")
      .select("relationship_id")
      .eq("relationship_id", ginaHankId);
    expect(synastry).toEqual([]);

    const { data: consents } = await admin
      .from("consents")
      .select("user_id, revoked_at")
      .eq("relationship_id", ginaHankId);
    expect(consents).toHaveLength(1);
    expect(consents![0].user_id).toBe(gina.id);
    expect(consents![0].revoked_at).not.toBeNull();

    const { data: audit } = await admin
      .from("audit_events")
      .select("actor_user_id, resource_type, metadata")
      .eq("event_type", "relationship.ended")
      .eq("resource_id", ginaHankId);
    expect(audit).toEqual([
      {
        actor_user_id: null,
        resource_type: "relationship",
        metadata: { reason: "member_deleted" },
      },
    ]);

    const { error: inviteError } = await gina.client.rpc("create_invite", {
      p_token_hash: newTokenHash(),
      p_policy_version: POLICY,
    });
    expect(inviteError).toBeNull();
  });
});
