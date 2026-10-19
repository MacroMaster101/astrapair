import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { configuredModel, getAiConfig } from "@/lib/ai/config";
import {
  buildRelationshipFacts,
  type EvidenceItem,
  type RelationshipFacts,
} from "@/lib/ai/facts";
import { findUnsupportedClaims, type UnsupportedClaim } from "@/lib/ai/guard";
import {
  countCategories,
  findPolicyFlags,
  findPolicyViolations,
} from "@/lib/ai/policy";
import { sanitizeName } from "@/lib/ai/prompts/names";
import {
  REPORT_PROMPT_VERSION,
  buildReportMessages,
} from "@/lib/ai/prompts/report";
import {
  AiInvalidOutputError,
  AiUnavailableError,
  getAiProvider,
  type AiProvider,
  type AiUsage,
} from "@/lib/ai/provider";
import {
  REPORT_JSON_SCHEMA,
  interpretationText,
  parseInterpretation,
  reportInterpretationSchema,
  type ReportInterpretation,
} from "@/lib/ai/report-schema";
import { countRecentUsage, recordUsage } from "@/lib/ai/usage";
import { requireUserId } from "@/lib/auth/session";
import {
  loadRelationshipContext,
  type RelationshipContext,
} from "@/lib/partner/service";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export interface StoredReport {
  interpretation: ReportInterpretation;
  evidence: EvidenceItem[];
  notes: string[];
  /** Canonical order: `a` is the member with the lower user id. */
  names: { a: string; b: string };
  completedAt: string;
  promptVersion: string;
  model: string;
}

export type ReportState =
  | { kind: "not_connected" }
  | { kind: "waiting_for_charts" }
  | { kind: "unavailable" }
  | { kind: "none" }
  | { kind: "generating" }
  | { kind: "failed" }
  | { kind: "ready"; outOfDate: boolean; report: StoredReport };

export type GenerateResult =
  /** `generated` is set only when a model call produced a new report. */
  | { ok: true; generated?: true }
  | {
      ok: false;
      code:
        | "not_connected"
        | "waiting_for_charts"
        | "in_progress"
        | "limit"
        | "ai_unavailable"
        | "invalid_output"
        | "error";
    };

type ErrorCode = Extract<GenerateResult, { ok: false }>["code"];

/**
 * How long a "generating" row counts as live. Keep in step with the 10 minute
 * interval in claim_report_generation (supabase/migrations/20260930100000_reports_ai.sql).
 * It must exceed the worst-case generation: ATTEMPTS calls of up to
 * CALL_OPTIONS.timeoutMs each (2 x 150 s = 5 minutes), so a running
 * generation is never taken over or shown as stale.
 */
const GENERATION_LEASE_MS = 10 * 60 * 1000;
const CALL_OPTIONS = { maxTokens: 3000, timeoutMs: 150000 };
const ATTEMPTS = 2;

/** Postgres SQLSTATE raised by the active-relationship trigger. */
const RELATIONSHIP_NOT_ACTIVE = "AP001";

/** Changes when either person's birth details, the prompt or the model change. */
function reportCacheKey(synastryKey: string, model: string): string {
  return createHash("sha256")
    .update(JSON.stringify([synastryKey, REPORT_PROMPT_VERSION, model]))
    .digest("hex");
}

const storedFactsSchema = z.object({
  names: z.object({ a: z.string(), b: z.string() }),
  evidence: z.array(z.object({ id: z.string(), label: z.string() })),
  notes: z.array(z.string()),
});

const REPORT_COLUMNS =
  "status, cache_key, facts_json, interpretation_json, prompt_version, model, generation_started_at, completed_at";

interface ReportRow {
  status: string;
  cache_key: string | null;
  facts_json: Json | null;
  interpretation_json: Json | null;
  prompt_version: string | null;
  model: string | null;
  generation_started_at: string | null;
  completed_at: string | null;
}

/** Reads with the user's client, so RLS limits it to active members. */
async function readReportRow(
  relationshipId: string,
): Promise<{ row: ReportRow | null } | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("compatibility_reports")
    .select(REPORT_COLUMNS)
    .eq("relationship_id", relationshipId)
    .maybeSingle();
  if (error) return { error: error.code || "unknown" };
  return { row: data };
}

function parseStoredReport(row: ReportRow): StoredReport | null {
  const interpretation = reportInterpretationSchema.safeParse(
    row.interpretation_json,
  );
  const facts = storedFactsSchema.safeParse(row.facts_json);
  if (
    !interpretation.success ||
    !facts.success ||
    !row.completed_at ||
    !row.prompt_version ||
    !row.model
  )
    return null;
  return {
    interpretation: interpretation.data,
    evidence: facts.data.evidence,
    notes: facts.data.notes,
    names: facts.data.names,
    completedAt: row.completed_at,
    promptVersion: row.prompt_version,
    model: row.model,
  };
}

const isGenerating = (row: ReportRow) =>
  row.status === "generating" &&
  row.generation_started_at !== null &&
  Date.now() - Date.parse(row.generation_started_at) < GENERATION_LEASE_MS;

/** The state a row shows, given the current cache key. */
function stateOfRow(
  row: ReportRow | null,
  currentKey: string | null,
): ReportState {
  if (!row) return { kind: "none" };
  if (isGenerating(row)) return { kind: "generating" };
  // A stale generation shows whatever it held before: a ready report or nothing.
  if (row.interpretation_json === null) return { kind: "failed" };
  const report = parseStoredReport(row);
  if (!report) return { kind: "failed" };
  return {
    kind: "ready",
    outOfDate: currentKey !== null && row.cache_key !== currentKey,
    report,
  };
}

/**
 * Logs what the flag tier of the policy filter found in a report that is about
 * to be stored, as category counts: never the report, the matched words or a
 * name. Monitoring only: it never throws and never changes the outcome.
 */
function logFlags(relationshipId: string, text: string, names: string[]) {
  try {
    const flags = countCategories(findPolicyFlags(text, { names }));
    if (Object.keys(flags).length > 0)
      console.info("Report flagged", { relationshipId, flags });
  } catch {
    // Nothing to do: the report is stored either way.
  }
}

function logFailure(relationshipId: string, stage: string, code: string) {
  console.error("Report generation failed", { relationshipId, stage, code });
}

export async function getReportState(): Promise<ReportState> {
  const context = await loadRelationshipContext();
  if (!context) return { kind: "not_connected" };
  if (context.error) return { kind: "unavailable" };
  if (context.chartsMissing || !context.synastryKey)
    return { kind: "waiting_for_charts" };

  const read = await readReportRow(context.relationshipId);
  if ("error" in read) {
    logFailure(context.relationshipId, "read", read.error);
    return { kind: "unavailable" };
  }
  // The model name getAiProvider() reports. With no model (AI disabled, or OpenAI
  // not set up) the stored report is not marked out of date: nothing changed.
  const model = configuredModel(getAiConfig());
  return stateOfRow(
    read.row,
    model === null ? null : reportCacheKey(context.synastryKey, model),
  );
}

/**
 * The shared report's facts, in canonical order (`a` is the member with the
 * lower user id) so both partners store and read the same text. Missing names
 * fall back to neutral labels, never "You", which would be wrong for one of them.
 */
function canonicalFacts(context: RelationshipContext): RelationshipFacts {
  const [a, b] = context.viewerIsA
    ? [context.viewer, context.partner]
    : [context.partner, context.viewer];
  return buildRelationshipFacts({
    names: {
      a: sanitizeName(a.displayName ?? "", "Partner A"),
      b: sanitizeName(b.displayName ?? "", "Partner B"),
    },
    a,
    b,
    synastry: context.synastry!,
  });
}

class GenerationFailure extends Error {
  constructor(readonly code: ErrorCode) {
    super("Report generation failed");
  }
}

const recordCall = (
  provider: AiProvider,
  context: RelationshipContext,
  usage: AiUsage,
  attempt: number,
) =>
  recordUsage({
    userId: context.viewerUserId,
    relationshipId: context.relationshipId,
    kind: "report",
    model: provider.model,
    promptVersion: REPORT_PROMPT_VERSION,
    usage,
    attempt,
  });

/**
 * Up to two model calls; null when neither answer is valid. An answer that
 * cannot be parsed, is cut off, or fails the schema, placement guard or policy
 * filter is retried once, with a corrective line for what went wrong. Usage is recorded for every call that spent tokens, with its attempt
 * number (the daily limit counts attempt 1 only).
 */
async function interpret(
  provider: AiProvider,
  facts: RelationshipFacts,
  context: RelationshipContext,
): Promise<ReportInterpretation | null> {
  const knownIds = new Set(facts.evidence.map((e) => e.id));
  // What the next attempt tells the model went wrong with the last one.
  let fix: {
    retry: boolean;
    policy: boolean;
    rejected?: UnsupportedClaim[];
  } = { retry: false, policy: false };
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let result: Awaited<ReturnType<AiProvider["generateJson"]>>;
    try {
      result = await provider.generateJson(
        buildReportMessages(facts, fix),
        REPORT_JSON_SCHEMA,
        CALL_OPTIONS,
      );
    } catch (e) {
      if (e instanceof AiInvalidOutputError) {
        await recordCall(provider, context, e.usage, attempt);
        logFailure(
          context.relationshipId,
          `validate-${attempt}`,
          e.code ?? "unparseable",
        );
        fix = { retry: true, policy: false };
        continue;
      }
      const unavailable = e instanceof AiUnavailableError;
      logFailure(
        context.relationshipId,
        "generate",
        unavailable ? e.reason : "unknown",
      );
      throw new GenerationFailure(unavailable ? "ai_unavailable" : "error");
    }
    await recordCall(provider, context, result.usage, attempt);
    const interpretation = parseInterpretation(result.json, knownIds);
    if (!interpretation) {
      logFailure(context.relationshipId, `validate-${attempt}`, "schema");
      fix = { retry: true, policy: false };
      continue;
    }
    const text = interpretationText(interpretation);
    const rejected = findUnsupportedClaims(text, facts.claims);
    const unsupported = rejected.length > 0;
    const names = [facts.names.a, facts.names.b];
    const violations = findPolicyViolations(text, { names });
    if (!unsupported && violations.length === 0) {
      logFlags(context.relationshipId, text, names);
      return interpretation;
    }
    // Codes only: the report's words and the matched text are never logged.
    if (unsupported)
      logFailure(
        context.relationshipId,
        `validate-${attempt}`,
        "unsupported_claims",
      );
    if (violations.length > 0)
      logFailure(
        context.relationshipId,
        `validate-${attempt}`,
        `policy:${[...new Set(violations.map((v) => v.category))].join(",")}`,
      );
    fix = { retry: unsupported, policy: violations.length > 0, rejected };
  }
  return null;
}

type AdminClient = ReturnType<typeof createAdminClient>;

/** Hands the claim back after a failure. Errors are logged and ignored. */
async function releaseClaim(
  admin: AdminClient,
  relationshipId: string,
  claimId: string,
) {
  try {
    const { error } = await admin.rpc("finish_report_generation", {
      p_relationship_id: relationshipId,
      p_claim_id: claimId,
      p_success: false,
      p_report: {},
    });
    if (error) logFailure(relationshipId, "release", error.code || "unknown");
  } catch {
    logFailure(relationshipId, "release", "exception");
  }
}

const fail = (code: ErrorCode): GenerateResult => ({ ok: false, code });

export async function generateReport(): Promise<GenerateResult> {
  // Outside any try: an unauthenticated request redirects to sign in.
  await requireUserId();

  let context: RelationshipContext | null;
  try {
    context = await loadRelationshipContext();
  } catch {
    console.error("Report generation failed", {
      stage: "context",
      code: "exception",
    });
    return fail("error");
  }
  if (!context) return fail("not_connected");
  const relationshipId = context.relationshipId;
  if (context.error) {
    logFailure(relationshipId, "context", "chart_or_synastry");
    return fail("error");
  }
  if (context.chartsMissing || !context.synastry || !context.synastryKey)
    return fail("waiting_for_charts");
  const synastryKey = context.synastryKey;

  let provider: AiProvider;
  try {
    provider = getAiProvider();
  } catch (e) {
    const unavailable = e instanceof AiUnavailableError;
    logFailure(relationshipId, "provider", unavailable ? e.reason : "unknown");
    return fail(unavailable ? "ai_unavailable" : "error");
  }
  const cacheKey = reportCacheKey(synastryKey, provider.model);

  const read = await readReportRow(relationshipId);
  if ("error" in read) {
    logFailure(relationshipId, "read", read.error);
    return fail("error");
  }
  const current = stateOfRow(read.row, cacheKey);
  // The stored report still matches: show it, no model call.
  if (current.kind === "ready" && !current.outOfDate) return { ok: true };
  if (current.kind === "generating") return fail("in_progress");

  try {
    const used = await countRecentUsage({ relationshipId, kind: "report" });
    if (used >= getAiConfig().dailyReportLimit) return fail("limit");
  } catch {
    logFailure(relationshipId, "usage", "count");
    return fail("error");
  }

  const facts = canonicalFacts(context);

  let admin: AdminClient;
  try {
    admin = createAdminClient();
  } catch {
    logFailure(relationshipId, "claim", "config");
    return fail("error");
  }
  const claimId = randomUUID();
  const { data: claimed, error: claimError } = await admin.rpc(
    "claim_report_generation",
    {
      p_relationship_id: relationshipId,
      p_pending_cache_key: cacheKey,
      p_claim_id: claimId,
    },
  );
  if (claimError) {
    logFailure(relationshipId, "claim", claimError.code || "unknown");
    // The partner disconnected between loading the context and claiming.
    return fail(
      claimError.code === RELATIONSHIP_NOT_ACTIVE ? "not_connected" : "error",
    );
  }
  if (!claimed) return fail("in_progress");

  // From here on the claim is ours: every failure path releases it.
  let interpretation: ReportInterpretation | null;
  try {
    interpretation = await interpret(provider, facts, context);
  } catch (e) {
    await releaseClaim(admin, relationshipId, claimId);
    return fail(e instanceof GenerationFailure ? e.code : "error");
  }
  if (!interpretation) {
    await releaseClaim(admin, relationshipId, claimId);
    return fail("invalid_output");
  }

  const report = {
    cache_key: cacheKey,
    synastry_input_hash: synastryKey,
    facts_json: {
      names: facts.names,
      evidence: facts.evidence,
      notes: facts.notes,
    },
    interpretation_json: interpretation,
    prompt_version: REPORT_PROMPT_VERSION,
    model: provider.model,
    generated_by: context.viewerUserId,
  };
  try {
    const { data: finished, error: finishError } = await admin.rpc(
      "finish_report_generation",
      {
        p_relationship_id: relationshipId,
        p_claim_id: claimId,
        p_success: true,
        p_report: report as unknown as Json,
      },
    );
    if (finishError) {
      // The partner disconnected while the report was being written.
      if (finishError.code === RELATIONSHIP_NOT_ACTIVE) {
        logFailure(relationshipId, "finish", RELATIONSHIP_NOT_ACTIVE);
        return fail("not_connected");
      }
      logFailure(relationshipId, "finish", finishError.code || "unknown");
      await releaseClaim(admin, relationshipId, claimId);
      return fail("error");
    }
    // No row with our claim: the relationship ended and the row was deleted.
    if (!finished) return fail("not_connected");
  } catch {
    logFailure(relationshipId, "finish", "exception");
    await releaseClaim(admin, relationshipId, claimId);
    return fail("error");
  }
  return { ok: true, generated: true };
}
