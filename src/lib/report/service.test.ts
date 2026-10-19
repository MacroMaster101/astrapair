import { createHash } from "node:crypto";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { buildRelationshipFacts } from "@/lib/ai/facts";
import { findUnsupportedClaims } from "@/lib/ai/guard";
import { POLICY_RETRY_INSTRUCTION, warmPolicyEngines } from "@/lib/ai/policy";
import {
  REPORT_PROMPT_VERSION,
  REPORT_RETRY_INSTRUCTION,
} from "@/lib/ai/prompts/report";
import {
  REPORT_SECTIONS,
  interpretationText,
  parseInterpretation,
  type ReportInterpretation,
} from "@/lib/ai/report-schema";
import {
  AiInvalidOutputError,
  AiUnavailableError,
  type AiMessage,
} from "@/lib/ai/types";
import { BuiltInProvider } from "@/lib/astrology/engine";
import { calculateSynastry } from "@/lib/astrology/synastry";
import type { BirthInput } from "@/lib/astrology/types";
import * as usage from "@/lib/ai/usage";
import type { RelationshipContext } from "@/lib/partner/service";

vi.mock("server-only", () => ({}));

type Result = {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
};
interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}
interface GenerateCall {
  messages: AiMessage[];
  schema: object;
  opts: unknown;
}
type Reply =
  | { json: unknown; usage: { inputTokens: number; outputTokens: number } }
  | Error;

const fake = vi.hoisted(() => ({
  context: null as unknown,
  contextThrows: false,
  reportRow: { data: null, error: null } as Result,
  reportReads: 0,
  rpc: {} as Record<string, Result | (() => Result)>,
  rpcCalls: [] as RpcCall[],
  providerThrows: null as Error | null,
  replies: [] as Reply[],
  generateCalls: [] as GenerateCall[],
  usageCount: 0,
  dailyReportLimit: 3,
  config: {} as Record<string, unknown>,
}));

vi.mock("@/lib/auth/session", () => ({
  requireUserId: vi.fn(async () => "user-1"),
}));
vi.mock("@/lib/partner/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/partner/service")>()),
  loadRelationshipContext: vi.fn(async () => {
    if (fake.contextThrows) throw new Error("Failed to load relationship");
    return fake.context;
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => {
            if (table !== "compatibility_reports")
              throw new Error(`unexpected table ${table}`);
            fake.reportReads += 1;
            return Promise.resolve(fake.reportRow);
          },
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      fake.rpcCalls.push({ name, args });
      const r = fake.rpc[name];
      return Promise.resolve(typeof r === "function" ? r() : r);
    },
  }),
}));
vi.mock("@/lib/ai/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/config")>()),
  getAiConfig: () => ({
    provider: "ollama",
    ollamaBaseUrl: "http://127.0.0.1:11434",
    ollamaModel: "test-model",
    dailyQuestionLimit: 30,
    dailyReportLimit: fake.dailyReportLimit,
    ...fake.config,
  }),
}));
// Pass-throughs that a test can make throw once.
vi.mock("@/lib/ai/guard", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ai/guard")>();
  return {
    ...original,
    findUnsupportedClaims: vi.fn(original.findUnsupportedClaims),
  };
});
vi.mock("@/lib/ai/report-schema", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/ai/report-schema")>();
  return {
    ...original,
    parseInterpretation: vi.fn(original.parseInterpretation),
  };
});
vi.mock("@/lib/ai/usage", () => ({
  countRecentUsage: vi.fn(async () => fake.usageCount),
  recordUsage: vi.fn(async () => {}),
}));
vi.mock("@/lib/ai/provider", async () => {
  const types = await import("@/lib/ai/types");
  return {
    AiInvalidOutputError: types.AiInvalidOutputError,
    AiUnavailableError: types.AiUnavailableError,
    getAiProvider: () => {
      if (fake.providerThrows) throw fake.providerThrows;
      return {
        name: "fake",
        model: "test-model",
        generateJson: async (
          messages: AiMessage[],
          schema: object,
          opts: unknown,
        ) => {
          fake.generateCalls.push({ messages, schema, opts });
          const reply = fake.replies.shift();
          if (!reply) throw new Error("no reply queued");
          if (reply instanceof Error) throw reply;
          return reply;
        },
        chat: async () => {
          throw new Error("chat is not used by reports");
        },
      };
    },
  };
});

const { summarizeChart, synastryKey } = await import("@/lib/partner/service");
const { generateReport, getReportState } = await import("./service");

const engine = new BuiltInProvider();
const colombo: BirthInput = {
  birthDate: "1990-07-15",
  birthTime: "12:00",
  accuracy: "exact",
  latitude: 6.93548,
  longitude: 79.84868,
  timezone: "Asia/Colombo",
};
const london: BirthInput = {
  birthDate: "1988-02-03",
  birthTime: "08:45",
  accuracy: "exact",
  latitude: 51.5074,
  longitude: -0.1278,
  timezone: "Europe/London",
};
const BIRTH_SECRETS = [
  "1990-07-15",
  "12:00",
  "Asia/Colombo",
  "6.93548",
  "79.84868",
  "1988-02-03",
  "08:45",
  "Europe/London",
  "51.5074",
];
const own = engine.calculateNatalChart(colombo);
const partner = engine.calculateNatalChart(london);

function makeContext(
  viewerUserId = "user-1",
  overrides: Partial<RelationshipContext> = {},
): RelationshipContext {
  const viewerIsA = viewerUserId < "user-2";
  const [chartA, chartB] = viewerIsA ? [own, partner] : [partner, own];
  return {
    relationshipId: "rel-1",
    connectedAt: "2026-09-01T00:00:00Z",
    viewerUserId,
    partnerUserId: "user-2",
    viewerIsA,
    names: { viewer: "Me", partner: "Sam" },
    viewer: summarizeChart(own, "Me"),
    partner: summarizeChart(partner, "Sam"),
    viewerChart: own,
    synastry: calculateSynastry(chartA, chartB),
    synastryKey: synastryKey(chartA, chartB),
    chartsMissing: false,
    error: false,
    ...overrides,
  };
}

/** The facts the service should build: names and people in canonical order. */
function canonicalFacts(context: RelationshipContext) {
  const [a, b] = context.viewerIsA
    ? [context.viewer, context.partner]
    : [context.partner, context.viewer];
  const [nameA, nameB] = context.viewerIsA
    ? [context.names.viewer, context.names.partner]
    : [context.names.partner, context.names.viewer];
  return buildRelationshipFacts({
    names: { a: nameA, b: nameB },
    a,
    b,
    synastry: context.synastry!,
  });
}

const cacheKey = (synKey: string, model = "test-model") =>
  createHash("sha256")
    .update(JSON.stringify([synKey, REPORT_PROMPT_VERSION, model]))
    .digest("hex");

const BODY =
  "You both bring warmth and patience to everyday life, and you tend to listen closely when the other person needs to talk.";

function interpretation(
  evidence: string[],
  extraBody = "",
): ReportInterpretation {
  return {
    sections: Object.fromEntries(
      REPORT_SECTIONS.map((s) => [
        s.key,
        {
          summary: `A gentle look at ${s.title.toLowerCase()}.`,
          body: BODY + extraBody,
          evidence,
        },
      ]),
    ) as ReportInterpretation["sections"],
    reflectionQuestions: [
      "What helps you feel heard?",
      "When do you feel closest to each other?",
      "How would you like to grow together?",
    ],
  };
}

const UNSUPPORTED = " Your Sun in the 13th house shows this.";
const reply = (json: unknown) => ({
  json,
  usage: { inputTokens: 1500, outputTokens: 1200 },
});

function readyRow(key: string, overrides: Record<string, unknown> = {}) {
  const context = makeContext();
  const facts = canonicalFacts(context);
  return {
    status: "ready",
    cache_key: key,
    facts_json: {
      names: facts.names,
      evidence: facts.evidence,
      notes: facts.notes,
    },
    interpretation_json: interpretation([facts.evidence[0].id]),
    prompt_version: "report-v1",
    model: "test-model",
    generation_started_at: "2026-09-30T10:00:00Z",
    completed_at: "2026-09-30T10:01:00Z",
    ...overrides,
  };
}

const minutesAgo = (n: number) =>
  new Date(Date.now() - n * 60_000).toISOString();

/** The attempt number of every recorded model call, in order. */
const usedAttempts = () =>
  vi.mocked(usage.recordUsage).mock.calls.map(([event]) => event.attempt);

const finishCalls = () =>
  fake.rpcCalls.filter((c) => c.name === "finish_report_generation");
const claimCalls = () =>
  fake.rpcCalls.filter((c) => c.name === "claim_report_generation");

// The policy filter's patterns compile on first use (about a second and a half);
// do it once up front so no test pays it, whatever the machine load.
beforeAll(() => {
  warmPolicyEngines();
}, 60_000);

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  fake.context = makeContext();
  fake.contextThrows = false;
  fake.reportRow = { data: null, error: null };
  fake.reportReads = 0;
  fake.rpc = {
    claim_report_generation: { data: true, error: null },
    finish_report_generation: { data: true, error: null },
  };
  fake.rpcCalls = [];
  fake.providerThrows = null;
  fake.replies = [];
  fake.generateCalls = [];
  fake.usageCount = 0;
  fake.dailyReportLimit = 3;
  fake.config = {};
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getReportState", () => {
  const currentKey = () => cacheKey(makeContext().synastryKey!);

  it("returns not_connected, unavailable and waiting_for_charts from the context", async () => {
    fake.context = null;
    expect(await getReportState()).toEqual({ kind: "not_connected" });
    fake.context = makeContext("user-1", { error: true });
    expect(await getReportState()).toEqual({ kind: "unavailable" });
    fake.context = makeContext("user-1", {
      chartsMissing: true,
      synastry: null,
      synastryKey: null,
    });
    expect(await getReportState()).toEqual({ kind: "waiting_for_charts" });
    expect(fake.reportReads).toBe(0);
  });

  it("returns none when no report exists", async () => {
    expect(await getReportState()).toEqual({ kind: "none" });
  });

  it("returns unavailable when the report cannot be read, logging no message", async () => {
    fake.reportRow = {
      data: null,
      error: { code: "XX000", message: "secret db detail" },
    };
    expect(await getReportState()).toEqual({ kind: "unavailable" });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret");
  });

  it("returns the ready report without calling the provider when the key matches", async () => {
    const row = readyRow(currentKey());
    fake.reportRow = { data: row, error: null };
    const state = await getReportState();
    expect(state).toEqual({
      kind: "ready",
      outOfDate: false,
      report: {
        interpretation: row.interpretation_json,
        evidence: row.facts_json.evidence,
        notes: row.facts_json.notes,
        names: { a: "Me", b: "Sam" },
        completedAt: "2026-09-30T10:01:00Z",
        promptVersion: "report-v1",
        model: "test-model",
      },
    });
    expect(fake.generateCalls).toHaveLength(0);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("marks the report out of date when the key differs", async () => {
    fake.reportRow = { data: readyRow("0".repeat(64)), error: null };
    const state = await getReportState();
    expect(state).toMatchObject({ kind: "ready", outOfDate: true });
  });

  it("does not mark a stored report out of date while AI is disabled or has no model", async () => {
    for (const config of [
      { provider: "disabled" },
      { provider: "openai", openaiModel: null },
    ]) {
      fake.config = config;
      fake.reportRow = { data: readyRow("0".repeat(64)), error: null };
      expect(await getReportState()).toMatchObject({
        kind: "ready",
        outOfDate: false,
      });
    }
  });

  it("keys the cached report on the OpenAI model when OpenAI is the provider", async () => {
    fake.config = { provider: "openai", openaiModel: "hosted-model" };
    fake.reportRow = {
      data: readyRow(cacheKey(makeContext().synastryKey!, "hosted-model")),
      error: null,
    };
    expect(await getReportState()).toMatchObject({
      kind: "ready",
      outOfDate: false,
    });
    fake.reportRow = { data: readyRow(currentKey()), error: null };
    expect(await getReportState()).toMatchObject({
      kind: "ready",
      outOfDate: true,
    });
  });

  it("returns generating while a recent generation runs", async () => {
    fake.reportRow = {
      data: {
        ...readyRow(currentKey()),
        status: "generating",
        generation_started_at: minutesAgo(1),
      },
      error: null,
    };
    expect(await getReportState()).toEqual({ kind: "generating" });
  });

  it("still shows generating nine minutes in, within the ten minute lease", async () => {
    fake.reportRow = {
      data: {
        ...readyRow(currentKey()),
        status: "generating",
        generation_started_at: minutesAgo(9),
      },
      error: null,
    };
    expect(await getReportState()).toEqual({ kind: "generating" });
  });

  it("treats a stale generation as the previous state", async () => {
    fake.reportRow = {
      data: {
        ...readyRow(currentKey()),
        status: "generating",
        generation_started_at: minutesAgo(11),
      },
      error: null,
    };
    expect(await getReportState()).toMatchObject({
      kind: "ready",
      outOfDate: false,
    });

    fake.reportRow = {
      data: {
        status: "generating",
        cache_key: null,
        facts_json: null,
        interpretation_json: null,
        prompt_version: null,
        model: null,
        generation_started_at: minutesAgo(11),
        completed_at: null,
      },
      error: null,
    };
    expect(await getReportState()).toEqual({ kind: "failed" });
  });

  it("returns failed for a failed row", async () => {
    fake.reportRow = {
      data: {
        status: "failed",
        cache_key: null,
        facts_json: null,
        interpretation_json: null,
        prompt_version: null,
        model: null,
        generation_started_at: minutesAgo(30),
        completed_at: null,
      },
      error: null,
    };
    expect(await getReportState()).toEqual({ kind: "failed" });
  });

  it("returns failed when the stored report is invalid", async () => {
    const valid = readyRow(currentKey());
    for (const overrides of [
      { interpretation_json: { sections: {}, reflectionQuestions: [] } },
      { interpretation_json: "nonsense" },
      { facts_json: { names: { a: "Me" }, evidence: [], notes: [] } },
      { facts_json: { ...valid.facts_json, evidence: [{ id: 1 }] } },
      { facts_json: null },
      { completed_at: null },
    ]) {
      fake.reportRow = { data: { ...valid, ...overrides }, error: null };
      expect(await getReportState()).toEqual({ kind: "failed" });
    }
  });
});

describe("generateReport", () => {
  it("claims, calls the provider once and stores the report", async () => {
    const context = makeContext();
    const facts = canonicalFacts(context);
    const known = facts.evidence[0].id;
    fake.replies = [reply(interpretation([known, "made-up-id"]))];

    expect(await generateReport()).toEqual({ ok: true, generated: true });

    const key = cacheKey(context.synastryKey!);
    expect(claimCalls()).toHaveLength(1);
    const claim = claimCalls()[0].args;
    expect(claim).toMatchObject({
      p_relationship_id: "rel-1",
      p_pending_cache_key: key,
    });
    expect(claim.p_claim_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    expect(fake.generateCalls).toHaveLength(1);
    expect(fake.generateCalls[0].opts).toEqual({
      maxTokens: 3000,
      timeoutMs: 150000,
    });

    expect(finishCalls()).toHaveLength(1);
    const finish = finishCalls()[0].args;
    expect(finish).toEqual({
      p_relationship_id: "rel-1",
      p_claim_id: claim.p_claim_id,
      p_success: true,
      p_report: {
        cache_key: key,
        synastry_input_hash: context.synastryKey,
        facts_json: {
          names: { a: "Me", b: "Sam" },
          evidence: facts.evidence,
          notes: facts.notes,
        },
        interpretation_json: parseInterpretation(
          interpretation([known, "made-up-id"]),
          new Set(facts.evidence.map((e) => e.id)),
        ),
        prompt_version: "report-v1",
        model: "test-model",
        generated_by: "user-1",
      },
    });
    const stored = finish.p_report as {
      interpretation_json: ReportInterpretation;
    };
    expect(stored.interpretation_json.sections.overview.evidence).toEqual([
      known,
    ]);

    expect(usage.recordUsage).toHaveBeenCalledTimes(1);
    expect(usage.recordUsage).toHaveBeenCalledWith({
      userId: "user-1",
      relationshipId: "rel-1",
      kind: "report",
      model: "test-model",
      promptVersion: "report-v1",
      usage: { inputTokens: 1500, outputTokens: 1200 },
      attempt: 1,
    });
  });

  it("sends and stores no birth input", async () => {
    fake.replies = [reply(interpretation([]))];
    expect(await generateReport()).toEqual({ ok: true, generated: true });
    const payload = JSON.stringify(finishCalls()[0].args);
    const prompt = JSON.stringify(fake.generateCalls[0].messages);
    for (const secret of BIRTH_SECRETS) {
      expect(payload).not.toContain(secret);
      expect(prompt).not.toContain(secret);
    }
  });

  it("names people in canonical order when the viewer sorts second", async () => {
    const context = makeContext("user-9");
    fake.context = context;
    fake.replies = [reply(interpretation([]))];
    expect(await generateReport()).toEqual({ ok: true, generated: true });
    const report = finishCalls()[0].args.p_report as {
      facts_json: { names: unknown; evidence: unknown };
      synastry_input_hash: string;
      generated_by: string;
    };
    expect(report.facts_json.names).toEqual({ a: "Sam", b: "Me" });
    expect(report.facts_json.evidence).toEqual(
      canonicalFacts(context).evidence,
    );
    expect(report.synastry_input_hash).toBe(synastryKey(partner, own));
    expect(report.generated_by).toBe("user-9");
  });

  it("stores the same facts whichever partner generates the report", async () => {
    fake.replies = [reply(interpretation([]))];
    await generateReport();
    // Same pair of charts seen from the other side: partner is "user-1".
    fake.context = {
      ...makeContext("user-9"),
      partnerUserId: "user-1",
      viewerIsA: false,
      names: { viewer: "Sam", partner: "Me" },
      viewer: summarizeChart(partner, "Sam"),
      partner: summarizeChart(own, "Me"),
      viewerChart: partner,
      synastry: calculateSynastry(own, partner),
      synastryKey: synastryKey(own, partner),
    };
    fake.replies = [reply(interpretation([]))];
    await generateReport();
    const [first, second] = finishCalls().map(
      (c) => (c.args.p_report as { facts_json: unknown }).facts_json,
    );
    expect(second).toEqual(first);
  });

  it("uses neutral names in the shared report when display names are missing", async () => {
    fake.context = makeContext("user-1", {
      names: { viewer: "You", partner: "Your partner" },
      viewer: summarizeChart(own, null),
      partner: summarizeChart(partner, null),
    });
    fake.replies = [reply(interpretation([]))];
    expect(await generateReport()).toEqual({ ok: true, generated: true });
    const report = finishCalls()[0].args.p_report as {
      facts_json: { names: unknown };
    };
    expect(report.facts_json.names).toEqual({ a: "Partner A", b: "Partner B" });
  });

  it("returns ok without a model call when the stored report is current", async () => {
    fake.reportRow = {
      data: readyRow(cacheKey(makeContext().synastryKey!)),
      error: null,
    };
    expect(await generateReport()).toEqual({ ok: true });
    expect(fake.generateCalls).toHaveLength(0);
    expect(fake.rpcCalls).toHaveLength(0);
    expect(usage.countRecentUsage).not.toHaveBeenCalled();
  });

  it("regenerates an out-of-date report", async () => {
    fake.reportRow = { data: readyRow("0".repeat(64)), error: null };
    fake.replies = [reply(interpretation([]))];
    expect(await generateReport()).toEqual({ ok: true, generated: true });
    expect(fake.generateCalls).toHaveLength(1);
    expect(finishCalls()[0].args.p_success).toBe(true);
  });

  it("returns in_progress without calling the provider when the claim is taken", async () => {
    fake.rpc.claim_report_generation = { data: false, error: null };
    expect(await generateReport()).toEqual({
      ok: false,
      code: "in_progress",
    });
    expect(fake.generateCalls).toHaveLength(0);
    expect(finishCalls()).toHaveLength(0);
  });

  it("returns in_progress while a recent generation runs", async () => {
    fake.reportRow = {
      data: {
        ...readyRow("0".repeat(64)),
        status: "generating",
        generation_started_at: minutesAgo(1),
      },
      error: null,
    };
    expect(await generateReport()).toEqual({
      ok: false,
      code: "in_progress",
    });
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("returns limit before claiming or calling the provider", async () => {
    fake.usageCount = 3;
    expect(await generateReport()).toEqual({ ok: false, code: "limit" });
    expect(usage.countRecentUsage).toHaveBeenCalledWith({
      relationshipId: "rel-1",
      kind: "report",
    });
    expect(fake.rpcCalls).toHaveLength(0);
    expect(fake.generateCalls).toHaveLength(0);
  });

  it("maps context problems to codes without claiming", async () => {
    fake.context = null;
    expect(await generateReport()).toEqual({
      ok: false,
      code: "not_connected",
    });
    fake.context = makeContext("user-1", {
      chartsMissing: true,
      synastry: null,
      synastryKey: null,
    });
    expect(await generateReport()).toEqual({
      ok: false,
      code: "waiting_for_charts",
    });
    fake.context = makeContext("user-1", { error: true });
    expect(await generateReport()).toEqual({ ok: false, code: "error" });
    fake.contextThrows = true;
    expect(await generateReport()).toEqual({ ok: false, code: "error" });
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("returns ai_unavailable when the provider is disabled, without claiming", async () => {
    fake.providerThrows = new AiUnavailableError("disabled");
    expect(await generateReport()).toEqual({
      ok: false,
      code: "ai_unavailable",
    });
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("releases the claim and records no usage when the model is unavailable", async () => {
    fake.replies = [new AiUnavailableError("offline")];
    expect(await generateReport()).toEqual({
      ok: false,
      code: "ai_unavailable",
    });
    expect(finishCalls()).toHaveLength(1);
    const finish = finishCalls()[0].args;
    expect(finish.p_success).toBe(false);
    expect(finish.p_claim_id).toBe(claimCalls()[0].args.p_claim_id);
    expect(usage.recordUsage).not.toHaveBeenCalled();
  });

  it.each(["timeout", "model_missing", "error"] as const)(
    "releases the claim and does not retry when the model fails with %s",
    async (reason) => {
      fake.replies = [new AiUnavailableError(reason)];
      expect(await generateReport()).toEqual({
        ok: false,
        code: "ai_unavailable",
      });
      expect(fake.generateCalls).toHaveLength(1);
      expect(finishCalls()).toHaveLength(1);
      expect(finishCalls()[0].args.p_success).toBe(false);
      expect(usage.recordUsage).not.toHaveBeenCalled();
    },
  );

  it("releases the claim with error when the provider fails unexpectedly", async () => {
    fake.replies = [new Error("socket hang up")];
    expect(await generateReport()).toEqual({ ok: false, code: "error" });
    expect(finishCalls()[0].args.p_success).toBe(false);
  });

  it("retries once after an unsupported claim and stores the second answer", async () => {
    const facts = canonicalFacts(makeContext());
    const bad = interpretation([], UNSUPPORTED);
    // The fixture really is unsupported by these facts.
    expect(
      findUnsupportedClaims(interpretationText(bad), facts.claims).length,
    ).toBeGreaterThan(0);
    fake.replies = [reply(bad), reply(interpretation([]))];
    expect(await generateReport()).toEqual({ ok: true, generated: true });
    expect(fake.generateCalls).toHaveLength(2);
    expect(usedAttempts()).toEqual([1, 2]);
    // Only the second attempt carries the corrective line.
    const systemLines = (call: { messages: AiMessage[] }) =>
      call.messages.filter((m) => m.role === "system").map((m) => m.content);
    expect(systemLines(fake.generateCalls[0])).not.toContainEqual(
      expect.stringContaining(REPORT_RETRY_INSTRUCTION),
    );
    const retryLines = systemLines(fake.generateCalls[1]);
    expect(retryLines).toContainEqual(
      expect.stringContaining(REPORT_RETRY_INSTRUCTION),
    );
    // The retry names what was rejected, in the model's own words.
    const placementLine = retryLines.find((l) =>
      l.startsWith(REPORT_RETRY_INSTRUCTION),
    )!;
    expect(placementLine).toContain('"Your Sun in the 13th house"');
    expect(placementLine).toContain(
      "Use only the aspects and placements listed in the facts.",
    );
    expect(finishCalls()).toHaveLength(1);
    const report = finishCalls()[0].args.p_report as {
      interpretation_json: ReportInterpretation;
    };
    expect(interpretationText(report.interpretation_json)).not.toContain(
      "13th",
    );
  });

  describe("policy filter", () => {
    const ADVICE = " Honestly, you should leave him.";
    const PREDICTION = " The relationship will end badly.";
    const systemLines = (call: { messages: AiMessage[] }) =>
      call.messages.filter((m) => m.role === "system").map((m) => m.content);

    it("retries once after advice and stores the clean second report", async () => {
      fake.replies = [
        reply(interpretation([], ADVICE)),
        reply(interpretation([])),
      ];
      expect(await generateReport()).toEqual({ ok: true, generated: true });
      expect(fake.generateCalls).toHaveLength(2);
      expect(usedAttempts()).toEqual([1, 2]);
      expect(systemLines(fake.generateCalls[0])).not.toContain(
        POLICY_RETRY_INSTRUCTION,
      );
      const retry = systemLines(fake.generateCalls[1]);
      expect(retry).toContain(POLICY_RETRY_INSTRUCTION);
      // A policy-only problem does not claim the placements were wrong.
      expect(retry).not.toContainEqual(
        expect.stringContaining(REPORT_RETRY_INSTRUCTION),
      );
      const report = finishCalls()[0].args.p_report as {
        interpretation_json: ReportInterpretation;
      };
      expect(interpretationText(report.interpretation_json)).not.toContain(
        "leave him",
      );
    });

    it("catches a violation in a section summary, not only in the body", async () => {
      const bad = interpretation([]);
      bad.sections.growth.summary = "You are 85% compatible overall.";
      fake.replies = [reply(bad), reply(interpretation([]))];
      expect(await generateReport()).toEqual({ ok: true, generated: true });
      expect(fake.generateCalls).toHaveLength(2);
    });

    it("releases the claim with invalid_output after two answers that break the policy", async () => {
      fake.replies = [
        reply(interpretation([], ADVICE)),
        reply(interpretation([], PREDICTION)),
      ];
      expect(await generateReport()).toEqual({
        ok: false,
        code: "invalid_output",
      });
      expect(fake.generateCalls).toHaveLength(2);
      expect(usedAttempts()).toEqual([1, 2]);
      expect(finishCalls()).toHaveLength(1);
      expect(finishCalls()[0].args.p_success).toBe(false);
    });

    it("does not retry a benign report", async () => {
      fake.replies = [
        reply(
          interpretation(
            [],
            " You may find it helps to talk about money. Many couples find that patience helps.",
          ),
        ),
      ];
      expect(await generateReport()).toEqual({ ok: true, generated: true });
      expect(fake.generateCalls).toHaveLength(1);
      expect(usedAttempts()).toEqual([1]);
    });

    it("sends both corrective lines, in one retry, for a placement and a policy problem", async () => {
      fake.replies = [
        reply(interpretation([], UNSUPPORTED + ADVICE)),
        reply(interpretation([])),
      ];
      expect(await generateReport()).toEqual({ ok: true, generated: true });
      expect(fake.generateCalls).toHaveLength(2);
      const retry = systemLines(fake.generateCalls[1]);
      expect(retry).toContainEqual(
        expect.stringContaining(REPORT_RETRY_INSTRUCTION),
      );
      expect(retry).toContain(POLICY_RETRY_INSTRUCTION);
      expect(
        retry.findIndex((l) => l.startsWith(REPORT_RETRY_INSTRUCTION)),
      ).toBeLessThan(retry.indexOf(POLICY_RETRY_INSTRUCTION));
    });

    it("sends the placement line, naming the placement, and no policy line for a placement-only problem", async () => {
      fake.replies = [
        reply(interpretation([], UNSUPPORTED)),
        reply(interpretation([])),
      ];
      await generateReport();
      const retry = systemLines(fake.generateCalls[1]);
      const line = retry.find((l) => l.startsWith(REPORT_RETRY_INSTRUCTION));
      expect(line).toContain('"Your Sun in the 13th house"');
      expect(retry).not.toContain(POLICY_RETRY_INSTRUCTION);
    });

    it("knows both display names", async () => {
      // The prompts use the names "Me" and "Sam"; a forecast about Sam is one.
      fake.replies = [
        reply(interpretation([], " Sam will cheat, warmth.")),
        reply(interpretation([])),
      ];
      expect(await generateReport()).toEqual({ ok: true, generated: true });
      expect(fake.generateCalls).toHaveLength(2);
      expect(systemLines(fake.generateCalls[1])).toContain(
        POLICY_RETRY_INSTRUCTION,
      );
    });

    describe("flag tier logging", () => {
      // Soft advice: not blocked, so the report is stored, and the flag tier reports it.
      const SOFT = " You are better off ending things, Sam, warmth.";

      it("logs category counts for a stored report, and nothing else", async () => {
        const spy = vi.spyOn(console, "info").mockImplementation(() => {});
        fake.replies = [reply(interpretation([], SOFT))];
        expect(await generateReport()).toEqual({ ok: true, generated: true });
        expect(fake.generateCalls).toHaveLength(1);
        expect(spy).toHaveBeenCalledTimes(1);
        const [message, details] = spy.mock.calls[0] as [
          string,
          { flags: Record<string, number> },
        ];
        expect(message).toBe("Report flagged");
        expect(Object.keys(details.flags)).toEqual(["directive"]);
        const logged = JSON.stringify(spy.mock.calls);
        expect(logged).not.toContain("ending things");
        expect(logged).not.toContain("Sam");
        expect(logged).not.toContain("warmth");
      });

      it("logs nothing for a clean report", async () => {
        const spy = vi.spyOn(console, "info").mockImplementation(() => {});
        fake.replies = [reply(interpretation([]))];
        await generateReport();
        expect(spy).not.toHaveBeenCalled();
      });

      it("never throws and never changes the outcome when logging fails", async () => {
        vi.spyOn(console, "info").mockImplementation(() => {
          throw new Error("logger down");
        });
        fake.replies = [reply(interpretation([], SOFT))];
        expect(await generateReport()).toEqual({ ok: true, generated: true });
        expect(finishCalls()[0].args.p_success).toBe(true);
      });
    });

    it("never logs the report's words or the matched text", async () => {
      fake.replies = [
        reply(interpretation([], " Honestly, you should leave him, warmth.")),
        reply(interpretation([], " Your husband is a narcissist, warmth.")),
      ];
      await generateReport();
      const logged = JSON.stringify(consoleError.mock.calls);
      expect(logged).not.toContain("warmth");
      expect(logged).not.toContain("leave him");
      expect(logged).not.toContain("narcissist");
      expect(logged).toContain("policy:directive");
      expect(logged).toContain("policy:diagnosis");
    });
  });

  // A schema or parse failure names no placement: the retry line is exactly the
  // generic one, with no list of rejected placements and no policy line.
  const retryLines = () =>
    fake.generateCalls[1].messages
      .filter((m) => m.role === "system")
      .map((m) => m.content);

  it("retries once after a schema-invalid answer", async () => {
    fake.replies = [reply({ sections: {} }), reply(interpretation([]))];
    expect(await generateReport()).toEqual({ ok: true, generated: true });
    expect(fake.generateCalls).toHaveLength(2);
    expect(usedAttempts()).toEqual([1, 2]);
    expect(retryLines()).toContain(REPORT_RETRY_INSTRUCTION);
    expect(retryLines().join(" ")).not.toContain("These were not in the facts");
    expect(retryLines()).not.toContain(POLICY_RETRY_INSTRUCTION);
  });

  it("records the spent tokens and retries once after unparseable or truncated output", async () => {
    const spent = { inputTokens: 900, outputTokens: 3000 };
    fake.replies = [new AiInvalidOutputError(spent), reply(interpretation([]))];
    expect(await generateReport()).toEqual({ ok: true, generated: true });
    expect(fake.generateCalls).toHaveLength(2);
    expect(vi.mocked(usage.recordUsage).mock.calls.map(([e]) => e)).toEqual([
      expect.objectContaining({ usage: spent, attempt: 1 }),
      expect.objectContaining({
        usage: { inputTokens: 1500, outputTokens: 1200 },
        attempt: 2,
      }),
    ]);
    expect(finishCalls().map((c) => c.args.p_success)).toEqual([true]);
    expect(retryLines()).toContain(REPORT_RETRY_INSTRUCTION);
    expect(retryLines().join(" ")).not.toContain("These were not in the facts");
    expect(retryLines()).not.toContain(POLICY_RETRY_INSTRUCTION);
  });

  it("logs why the output was unusable when the provider says so, and unparseable otherwise", async () => {
    const spent = { inputTokens: 900, outputTokens: 3000 };
    fake.replies = [
      new AiInvalidOutputError(spent, "length"),
      new AiInvalidOutputError(spent),
    ];
    await generateReport();
    const codes = (
      consoleError.mock.calls as [string, Record<string, string>][]
    )
      .filter(([message]) => message === "Report generation failed")
      .map(([, details]) => [details.stage, details.code])
      .filter(([stage]) => stage.startsWith("validate"));
    expect(codes).toEqual([
      ["validate-1", "length"],
      ["validate-2", "unparseable"],
    ]);
  });

  it("releases the claim with invalid_output after two unparseable answers", async () => {
    const spent = { inputTokens: 900, outputTokens: 3000 };
    fake.replies = [
      new AiInvalidOutputError(spent),
      new AiInvalidOutputError(spent),
    ];
    expect(await generateReport()).toEqual({
      ok: false,
      code: "invalid_output",
    });
    expect(fake.generateCalls).toHaveLength(2);
    expect(usedAttempts()).toEqual([1, 2]);
    expect(finishCalls()).toHaveLength(1);
    expect(finishCalls()[0].args).toMatchObject({
      p_success: false,
      p_claim_id: claimCalls()[0].args.p_claim_id,
    });
  });

  it("does not retry when the model itself is unavailable", async () => {
    fake.replies = [new AiUnavailableError("timeout")];
    expect(await generateReport()).toEqual({
      ok: false,
      code: "ai_unavailable",
    });
    expect(fake.generateCalls).toHaveLength(1);
  });

  it("releases the claim with invalid_output after two unsupported answers", async () => {
    fake.replies = [
      reply(interpretation([], UNSUPPORTED)),
      reply(interpretation([], UNSUPPORTED)),
    ];
    expect(await generateReport()).toEqual({
      ok: false,
      code: "invalid_output",
    });
    expect(fake.generateCalls).toHaveLength(2);
    expect(usedAttempts()).toEqual([1, 2]);
    expect(finishCalls()).toHaveLength(1);
    expect(finishCalls()[0].args.p_success).toBe(false);
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain("13th");
    expect(logged).not.toContain("warmth");
  });

  it("returns not_connected when finishing finds the row gone", async () => {
    fake.replies = [reply(interpretation([]))];
    fake.rpc.finish_report_generation = { data: false, error: null };
    expect(await generateReport()).toEqual({
      ok: false,
      code: "not_connected",
    });
    expect(finishCalls()).toHaveLength(1);
  });

  it("returns not_connected when the relationship ended before finishing", async () => {
    fake.replies = [reply(interpretation([]))];
    let first = true;
    fake.rpc.finish_report_generation = () => {
      if (first) {
        first = false;
        return {
          data: null,
          error: { code: "AP001", message: "secret-detail" },
        };
      }
      return { data: false, error: null };
    };
    expect(await generateReport()).toEqual({
      ok: false,
      code: "not_connected",
    });
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain("secret-detail");
  });

  it("releases the claim when storing fails for another reason", async () => {
    fake.replies = [reply(interpretation([]))];
    let first = true;
    fake.rpc.finish_report_generation = () => {
      if (first) {
        first = false;
        return { data: null, error: { code: "XX000", message: "secret" } };
      }
      return { data: true, error: null };
    };
    expect(await generateReport()).toEqual({ ok: false, code: "error" });
    expect(finishCalls().map((c) => c.args.p_success)).toEqual([true, false]);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret");
  });

  it("ignores a failure to release the claim", async () => {
    fake.replies = [new AiUnavailableError("timeout")];
    fake.rpc.finish_report_generation = {
      data: null,
      error: { code: "P0001", message: "relationship_not_active" },
    };
    expect(await generateReport()).toEqual({
      ok: false,
      code: "ai_unavailable",
    });
  });

  it("matches the not-active error by code, not by message", async () => {
    fake.replies = [reply(interpretation([]))];
    fake.rpc.finish_report_generation = {
      data: null,
      error: { code: "P0001", message: "relationship_not_active" },
    };
    expect(await generateReport()).toEqual({ ok: false, code: "error" });
  });

  it("releases the claim when the finish call throws", async () => {
    fake.replies = [reply(interpretation([]))];
    let first = true;
    fake.rpc.finish_report_generation = () => {
      if (first) {
        first = false;
        throw new Error("secret network failure");
      }
      return { data: true, error: null };
    };
    expect(await generateReport()).toEqual({ ok: false, code: "error" });
    expect(finishCalls().map((c) => c.args.p_success)).toEqual([true, false]);
    expect(finishCalls()[1].args.p_claim_id).toBe(
      claimCalls()[0].args.p_claim_id,
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret");
  });

  it("releases the claim when parsing the answer throws", async () => {
    fake.replies = [reply(interpretation([]))];
    vi.mocked(parseInterpretation).mockImplementationOnce(() => {
      throw new Error("secret parse failure");
    });
    expect(await generateReport()).toEqual({ ok: false, code: "error" });
    expect(finishCalls()).toHaveLength(1);
    expect(finishCalls()[0].args).toMatchObject({
      p_success: false,
      p_claim_id: claimCalls()[0].args.p_claim_id,
    });
  });

  it("releases the claim when the claim guard throws", async () => {
    fake.replies = [reply(interpretation([]))];
    vi.mocked(findUnsupportedClaims).mockImplementationOnce(() => {
      throw new Error("secret guard failure");
    });
    expect(await generateReport()).toEqual({ ok: false, code: "error" });
    expect(finishCalls()).toHaveLength(1);
    expect(finishCalls()[0].args).toMatchObject({
      p_success: false,
      p_claim_id: claimCalls()[0].args.p_claim_id,
    });
  });

  it("returns error when the claim fails", async () => {
    fake.rpc.claim_report_generation = {
      data: null,
      error: { code: "XX000", message: "secret" },
    };
    expect(await generateReport()).toEqual({ ok: false, code: "error" });
    expect(fake.generateCalls).toHaveLength(0);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret");
  });

  it("returns not_connected when the claim finds the relationship ended", async () => {
    fake.rpc.claim_report_generation = {
      data: null,
      error: { code: "AP001", message: "relationship_not_active" },
    };
    expect(await generateReport()).toEqual({
      ok: false,
      code: "not_connected",
    });
    expect(fake.generateCalls).toHaveLength(0);
    expect(finishCalls()).toHaveLength(0);
  });

  it("returns error when usage cannot be counted", async () => {
    vi.mocked(usage.countRecentUsage).mockRejectedValueOnce(
      new Error("Failed to count usage"),
    );
    expect(await generateReport()).toEqual({ ok: false, code: "error" });
    expect(fake.rpcCalls).toHaveLength(0);
  });
});
