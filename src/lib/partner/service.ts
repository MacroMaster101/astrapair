import "server-only";
import { createHash } from "node:crypto";
import { ENGINE_VERSION } from "@/lib/astrology/engine";
import { inputHash } from "@/lib/astrology/input-hash";
import { signLabel } from "@/lib/astrology/interpretations";
import {
  calculateSynastry,
  orientForViewer,
  type SynastryFacts,
} from "@/lib/astrology/synastry";
import type { Body, NatalChart } from "@/lib/astrology/types";
import { getProfile, requireUserId } from "@/lib/auth/session";
import { bigThreeSigns } from "@/components/chart/big-three-values";
import {
  getChartForVerifiedPartner,
  getCurrentChart,
  getOwnBirthProfile,
} from "@/lib/birth-profile/service";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/** Everything here is safe to show to the other person: signs only, no birth input. */
export interface PartnerSummary {
  displayName: string | null;
  hasChart: boolean;
  bigThree: { sun: string; moon: string; ascendant: string } | null;
  signs: { body: Body; sign: string }[] | null;
}

export type PartnerState =
  | {
      kind: "none";
      hasBirthProfile: boolean;
      pendingInvite: { expiresAt: string } | null;
    }
  | {
      kind: "connected";
      relationshipId: string;
      connectedAt: string;
      you: PartnerSummary;
      partner: PartnerSummary;
      /** Oriented so that `a` is the viewer. */
      synastry: SynastryFacts | null;
      synastryError: boolean;
    };

export function summarizeChart(
  chart: NatalChart | null,
  displayName: string | null,
): PartnerSummary {
  if (!chart)
    return { displayName, hasChart: false, bigThree: null, signs: null };
  const { sun, moon, ascendant } = bigThreeSigns(chart);
  return {
    displayName,
    hasChart: true,
    bigThree: { sun, moon, ascendant },
    // Without a birth time the Moon is a range of signs, so use the Big Three text.
    signs: chart.placements.map((p) => ({
      body: p.body,
      sign: p.body === "moon" ? moon : signLabel(p.sign),
    })),
  };
}

/** Changes whenever either person's birth details, or the engine, change. */
export function synastryKey(chartA: NatalChart, chartB: NatalChart): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        ENGINE_VERSION,
        inputHash(chartA.input, ENGINE_VERSION),
        inputHash(chartB.input, ENGINE_VERSION),
      ]),
    )
    .digest("hex");
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function parseStoredFacts(json: unknown): SynastryFacts | null {
  if (
    isObject(json) &&
    json.schemaVersion === 1 &&
    json.engineVersion === ENGINE_VERSION &&
    Array.isArray(json.aspects) &&
    isObject(json.overlays) &&
    isObject(json.excluded)
  )
    return json as unknown as SynastryFacts;
  return null;
}

/** Carries a stage and a short code only: messages can embed birth data. */
class SynastryFailure extends Error {
  constructor(
    readonly stage: "load" | "calculate" | "store",
    readonly code: string,
  ) {
    super("Synastry step failed");
  }
}

const dbCode = (e: { code?: string | null }) => e.code || "unknown";

/**
 * Returns the stored synastry facts for this pair of charts (a first, b second),
 * recalculating and storing them when the stored row is missing or stale. `key`
 * is `synastryKey(chartA, chartB)`. Reads use the user's client (RLS); the
 * write is admin-only.
 */
async function loadOrCalculateSynastry(
  relationshipId: string,
  chartA: NatalChart,
  chartB: NatalChart,
  key: string,
): Promise<SynastryFacts> {
  const supabase = await createClient();
  const { data: stored, error: loadError } = await supabase
    .from("synastry")
    .select("input_hash, facts_json")
    .eq("relationship_id", relationshipId)
    .maybeSingle();
  if (loadError) throw new SynastryFailure("load", dbCode(loadError));
  if (stored?.input_hash === key) {
    const facts = parseStoredFacts(stored.facts_json);
    if (facts) return facts;
  }

  let facts: SynastryFacts;
  try {
    facts = calculateSynastry(chartA, chartB);
  } catch (e) {
    throw new SynastryFailure("calculate", (e as Error)?.name ?? "Error");
  }
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    throw new SynastryFailure("store", "config");
  }
  const { error: storeError } = await admin.from("synastry").upsert(
    {
      relationship_id: relationshipId,
      input_hash: key,
      facts_json: facts as unknown as Json,
      calculation_version: ENGINE_VERSION,
    },
    { onConflict: "relationship_id" },
  );
  if (storeError) throw new SynastryFailure("store", dbCode(storeError));
  return facts;
}

/** The connection status only: two cheap RPCs, no charts and no synastry. */
export type PartnerOverview =
  | { kind: "none"; pendingInvite: { expiresAt: string } | null }
  | { kind: "connected"; partnerDisplayName: string | null };

export async function getPartnerOverview(): Promise<PartnerOverview> {
  await requireUserId();
  const supabase = await createClient();

  const { data: relationships, error: relationshipError } = await supabase.rpc(
    "get_my_relationship",
  );
  if (relationshipError) throw new Error("Failed to load relationship");
  const relationship = relationships?.[0];
  if (relationship) {
    return {
      kind: "connected",
      partnerDisplayName: relationship.partner_display_name,
    };
  }

  const { data: invites, error: inviteError } = await supabase.rpc(
    "get_my_pending_invite",
  );
  if (inviteError) throw new Error("Failed to load invite");
  const invite = invites?.[0];
  return {
    kind: "none",
    pendingInvite: invite ? { expiresAt: invite.expires_at } : null,
  };
}

/**
 * Everything the server knows about the viewer's active relationship. Only the
 * summaries are safe to send to the browser. `viewerChart` is the viewer's own
 * full chart: it contains their birth input (date, time, coordinates,
 * timezone), so it must never be shown to the partner, serialized into a
 * prompt, or stored. Consumers that need chart facts go through
 * `buildNatalFacts`.
 */
export interface RelationshipContext {
  relationshipId: string;
  connectedAt: string;
  viewerUserId: string;
  partnerUserId: string;
  /** Side "a" is the member with the lower user id. */
  viewerIsA: boolean;
  /** Display names, or "You" and "Your partner" when a name is missing. */
  names: { viewer: string; partner: string };
  viewer: PartnerSummary;
  partner: PartnerSummary;
  viewerChart: NatalChart | null;
  /** Canonical orientation: `a` is the member with the lower user id. */
  synastry: SynastryFacts | null;
  /** `synastryKey` of the canonical charts, set whenever `synastry` is. */
  synastryKey: string | null;
  /** Either person has no chart yet (normal, not an error). */
  chartsMissing: boolean;
  /** A chart failed to load, or synastry failed to load or calculate. */
  error: boolean;
}

/** Null when the viewer is not in an active relationship. */
export async function loadRelationshipContext(): Promise<RelationshipContext | null> {
  const userId = await requireUserId();
  const supabase = await createClient();

  const { data: relationships, error: relationshipError } = await supabase.rpc(
    "get_my_relationship",
  );
  if (relationshipError) throw new Error("Failed to load relationship");
  const relationship = relationships?.[0];
  if (!relationship) return null;

  const relationshipId = relationship.relationship_id;
  const partnerUserId = relationship.partner_user_id;
  const [ownProfile, profile] = await Promise.all([
    getOwnBirthProfile(),
    getProfile(),
  ]);

  // The relationship RPC returned a row, which proves the current user is an
  // active member with this partner.
  const ownResult = ownProfile ? await getCurrentChart(ownProfile) : null;
  const ownChart = ownResult?.chart ?? null;
  const partnerResult = await getChartForVerifiedPartner(partnerUserId);
  const partnerChart = partnerResult.chart;

  // A chart that is missing is normal; one that failed to load is an error.
  let error =
    (ownResult !== null && ownResult.chart === null) ||
    "error" in partnerResult;

  const viewerIsA = userId < partnerUserId;
  let synastry: SynastryFacts | null = null;
  let key: string | null = null;
  if (ownChart && partnerChart) {
    const [chartA, chartB] = viewerIsA
      ? [ownChart, partnerChart]
      : [partnerChart, ownChart];
    try {
      const canonicalKey = synastryKey(chartA, chartB);
      synastry = await loadOrCalculateSynastry(
        relationshipId,
        chartA,
        chartB,
        canonicalKey,
      );
      key = canonicalKey;
    } catch (e) {
      error = true;
      console.error("Synastry failed", {
        relationshipId,
        stage: e instanceof SynastryFailure ? e.stage : "calculate",
        code: e instanceof SynastryFailure ? e.code : "unknown",
      });
    }
  }

  return {
    relationshipId,
    connectedAt: relationship.connected_at,
    viewerUserId: userId,
    partnerUserId,
    viewerIsA,
    names: {
      viewer: profile.display_name || "You",
      partner: relationship.partner_display_name || "Your partner",
    },
    viewer: summarizeChart(ownChart, profile.display_name),
    partner: summarizeChart(partnerChart, relationship.partner_display_name),
    viewerChart: ownChart,
    synastry,
    synastryKey: key,
    chartsMissing: !ownChart || !partnerChart,
    error,
  };
}

export async function getPartnerState(): Promise<PartnerState> {
  const context = await loadRelationshipContext();
  if (context) {
    return {
      kind: "connected",
      relationshipId: context.relationshipId,
      connectedAt: context.connectedAt,
      you: context.viewer,
      partner: context.partner,
      synastry: context.synastry
        ? orientForViewer(context.synastry, context.viewerIsA)
        : null,
      synastryError: context.error,
    };
  }

  const supabase = await createClient();
  const ownProfile = await getOwnBirthProfile();
  const { data: invites, error: inviteError } = await supabase.rpc(
    "get_my_pending_invite",
  );
  if (inviteError) throw new Error("Failed to load invite");
  const invite = invites?.[0];
  return {
    kind: "none",
    hasBirthProfile: ownProfile !== null,
    pendingInvite: invite ? { expiresAt: invite.expires_at } : null,
  };
}
