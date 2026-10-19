import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { buildNatalFacts, buildRelationshipFacts } from "@/lib/ai/facts";
import { ASSISTANT_PROMPT_VERSION } from "@/lib/ai/prompts/assistant";
import { CRISIS_REPLY, SENSITIVE_INSTRUCTION } from "@/lib/ai/safety";
import {
  AiInvalidOutputError,
  AiUnavailableError,
  type AiMessage,
} from "@/lib/ai/types";
import { BuiltInProvider } from "@/lib/astrology/engine";
import { calculateSynastry } from "@/lib/astrology/synastry";
import type { BirthInput } from "@/lib/astrology/types";
import type { RelationshipContext } from "@/lib/partner/service";
import * as usage from "@/lib/ai/usage";
import * as analytics from "@/lib/analytics/track";

import { warmPolicyEngines } from "@/lib/ai/policy";

vi.mock("server-only", () => ({}));

type Reply =
  | { text: string; usage: { inputTokens: number; outputTokens: number } }
  | Error;
type DbError = { code?: string } | null;
interface InsertCall {
  table: string;
  rows: unknown;
}
interface UpdateCall {
  table: string;
  values: Record<string, unknown>;
  id: unknown;
}
interface StoredRow {
  id: string;
  role: string;
  content: string;
  model?: string | null;
  created_at: string;
}

const fake = vi.hoisted(() => ({
  userId: "user-1",
  thread: null as Record<string, unknown> | null,
  threadError: null as DbError,
  threadList: [] as Record<string, unknown>[],
  /** Column and value of every eq() filter on a thread list query. */
  threadFilters: [] as [string, unknown][],
  threadListError: null as DbError,
  messages: [] as StoredRow[],
  profile: { id: "bp-1" } as unknown,
  chart: null as unknown,
  chartFailed: false,
  displayName: "Me" as string | null,
  context: null as unknown,
  reportState: { kind: "none" } as unknown,
  reportThrows: false,
  providerThrows: null as Error | null,
  replies: [] as Reply[],
  chatCalls: [] as { messages: AiMessage[]; opts: unknown }[],
  usageCount: 0,
  limit: 30,
  inserts: [] as InsertCall[],
  updates: [] as UpdateCall[],
  adminInserts: [] as InsertCall[],
  insertError: null as DbError,
  updateError: null as DbError,
  createdThread: { id: "thread-new" } as { id: string } | null,
  createError: null as DbError,
}));

vi.mock("@/lib/auth/session", () => ({
  requireUserId: vi.fn(async () => fake.userId),
  getProfile: vi.fn(async () => ({
    id: fake.userId,
    display_name: fake.displayName,
  })),
}));
vi.mock("@/lib/birth-profile/service", () => ({
  getOwnBirthProfile: vi.fn(async () => fake.profile),
  getCurrentChart: vi.fn(async () =>
    fake.chartFailed ? { chart: null, error: true } : { chart: fake.chart },
  ),
}));
vi.mock("@/lib/partner/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/partner/service")>()),
  loadRelationshipContext: vi.fn(async () => fake.context),
}));
vi.mock("@/lib/report/service", () => ({
  getReportState: vi.fn(async () => {
    if (fake.reportThrows) throw new Error("report failed");
    return fake.reportState;
  }),
}));
vi.mock("@/lib/ai/config", () => ({
  getAiConfig: () => ({
    provider: "ollama",
    ollamaBaseUrl: "http://127.0.0.1:11434",
    ollamaModel: "test-model",
    dailyQuestionLimit: fake.limit,
    dailyReportLimit: 3,
  }),
}));
vi.mock("@/lib/analytics/track", () => ({
  trackAfterResponse: vi.fn(),
}));
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
        generateJson: async () => {
          throw new Error("generateJson is not used by the assistant");
        },
        chat: async (messages: AiMessage[], opts: unknown) => {
          fake.chatCalls.push({ messages, opts });
          const reply = fake.replies.shift();
          if (!reply) throw new Error("no reply queued");
          if (reply instanceof Error) throw reply;
          return reply;
        },
      };
    },
  };
});

/** A chainable, awaitable query on the user client (RLS reads). */
function userQuery(table: string) {
  const state = { single: false, ascending: true, limit: Infinity };
  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => {
      if (table === "ai_threads") fake.threadFilters.push([column, value]);
      return query;
    },
    order: (_column: string, opts?: { ascending?: boolean }) => {
      state.ascending = opts?.ascending ?? true;
      return query;
    },
    limit: (n: number, opts?: { referencedTable?: string }) => {
      if (!opts?.referencedTable) state.limit = n;
      return query;
    },
    maybeSingle: () => {
      state.single = true;
      return query;
    },
    then: (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) => {
      let result: unknown;
      if (table === "ai_threads" && state.single)
        result = { data: fake.thread, error: fake.threadError };
      else if (table === "ai_threads")
        result = { data: fake.threadList, error: fake.threadListError };
      else {
        const rows = state.ascending
          ? [...fake.messages]
          : [...fake.messages].reverse().slice(0, state.limit);
        result = { data: rows, error: null };
      }
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return query;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (table: string) => userQuery(table) }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      insert: (rows: unknown) => {
        fake.inserts.push({ table, rows });
        if (table === "ai_threads")
          return {
            select: () => ({
              single: async () => ({
                data: fake.createdThread,
                error: fake.createError,
              }),
            }),
          };
        return Promise.resolve({ error: fake.insertError });
      },
      update: (values: Record<string, unknown>) => ({
        eq: async (_column: string, id: unknown) => {
          fake.updates.push({ table, values, id });
          return { error: fake.updateError };
        },
      }),
    }),
  }),
}));

const { summarizeChart, synastryKey } = await import("@/lib/partner/service");
const {
  askQuestion,
  createThread,
  getRemainingQuestions,
  getThread,
  listThreads,
  titleFromQuestion,
} = await import("./service");

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
  "-0.1278",
];
const own = engine.calculateNatalChart(colombo);
const partner = engine.calculateNatalChart(london);

function makeContext(
  overrides: Partial<RelationshipContext> = {},
): RelationshipContext {
  return {
    relationshipId: "rel-1",
    connectedAt: "2026-09-01T00:00:00Z",
    viewerUserId: "user-1",
    partnerUserId: "user-2",
    viewerIsA: true,
    names: { viewer: "Me", partner: "Sam" },
    viewer: summarizeChart(own, "Me"),
    partner: summarizeChart(partner, "Sam"),
    viewerChart: own,
    synastry: calculateSynastry(own, partner),
    synastryKey: synastryKey(own, partner),
    chartsMissing: false,
    error: false,
    ...overrides,
  };
}

const chartThread = (overrides: Record<string, unknown> = {}) => ({
  id: "thread-1",
  thread_type: "chart",
  title: "About my chart",
  relationship_id: null,
  updated_at: "2026-09-30T10:00:00Z",
  ...overrides,
});
const relationshipThread = (overrides: Record<string, unknown> = {}) =>
  chartThread({
    thread_type: "relationship",
    title: "About us",
    relationship_id: "rel-1",
    ...overrides,
  });

const answer = (text: string, inputTokens = 120, outputTokens = 80) => ({
  text,
  usage: { inputTokens, outputTokens },
});
const SUPPORTED = "Your chart suggests a thoughtful, steady approach to life.";
const UNSUPPORTED = "Your Sun in the 13th house shows this.";

const adminInserts = () =>
  fake.inserts.filter((i) => i.table === "ai_messages");
const storedRows = () =>
  adminInserts().flatMap((i) => i.rows as Record<string, unknown>[]);
const recordedAttempts = () =>
  vi.mocked(usage.recordUsage).mock.calls.map(([event]) => event.attempt);
const joined = (messages: AiMessage[]) =>
  messages.map((m) => m.content).join("\n");

// The policy filter's patterns compile on first use (about a second and a half);
// do it once up front so no test pays it, whatever the machine load.
beforeAll(() => {
  warmPolicyEngines();
}, 60_000);

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  fake.userId = "user-1";
  fake.thread = chartThread();
  fake.threadError = null;
  fake.threadList = [];
  fake.threadFilters = [];
  fake.threadListError = null;
  fake.messages = [];
  fake.profile = { id: "bp-1" };
  fake.chart = own;
  fake.chartFailed = false;
  fake.displayName = "Me";
  fake.context = makeContext();
  fake.reportState = { kind: "none" };
  fake.reportThrows = false;
  fake.providerThrows = null;
  fake.replies = [];
  fake.chatCalls = [];
  fake.usageCount = 0;
  fake.limit = 30;
  fake.inserts = [];
  fake.updates = [];
  fake.insertError = null;
  fake.updateError = null;
  fake.createdThread = { id: "thread-new" };
  fake.createError = null;
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createThread", () => {
  it("returns no_chart for a chart thread without a chart", async () => {
    fake.profile = null;
    expect(await createThread("chart")).toEqual({
      ok: false,
      code: "no_chart",
    });
    fake.profile = { id: "bp-1" };
    fake.chartFailed = true;
    expect(await createThread("chart")).toEqual({
      ok: false,
      code: "no_chart",
    });
    expect(fake.inserts).toHaveLength(0);
  });

  it("returns not_connected for a relationship thread when not connected", async () => {
    fake.context = null;
    expect(await createThread("relationship")).toEqual({
      ok: false,
      code: "not_connected",
    });
    expect(fake.inserts).toHaveLength(0);
  });

  it("creates a chart thread owned by the user", async () => {
    expect(await createThread("chart")).toEqual({
      ok: true,
      threadId: "thread-new",
    });
    expect(fake.inserts).toEqual([
      {
        table: "ai_threads",
        rows: {
          owner_user_id: "user-1",
          relationship_id: null,
          thread_type: "chart",
          title: "About my chart",
        },
      },
    ]);
  });

  it("creates a relationship thread that stores the relationship id", async () => {
    expect(await createThread("relationship")).toEqual({
      ok: true,
      threadId: "thread-new",
    });
    expect(fake.inserts[0].rows).toEqual({
      owner_user_id: "user-1",
      relationship_id: "rel-1",
      thread_type: "relationship",
      title: "About us",
    });
  });

  it("reuses the newest empty chart thread instead of creating another", async () => {
    fake.threadList = [
      { id: "has-messages", ai_messages: [{ id: "m1" }] },
      { id: "empty-newest", ai_messages: [] },
      { id: "empty-older", ai_messages: [] },
    ];
    expect(await createThread("chart")).toEqual({
      ok: true,
      threadId: "empty-newest",
    });
    expect(fake.inserts).toHaveLength(0);
    expect(fake.threadFilters).toEqual([
      ["owner_user_id", "user-1"],
      ["thread_type", "chart"],
    ]);
  });

  it("reuses an empty relationship thread only for the current relationship", async () => {
    fake.threadList = [{ id: "empty-rel", ai_messages: [] }];
    expect(await createThread("relationship")).toEqual({
      ok: true,
      threadId: "empty-rel",
    });
    expect(fake.inserts).toHaveLength(0);
    expect(fake.threadFilters).toEqual([
      ["owner_user_id", "user-1"],
      ["thread_type", "relationship"],
      ["relationship_id", "rel-1"],
    ]);
  });

  it("creates a thread when every existing one has messages", async () => {
    fake.threadList = [{ id: "busy", ai_messages: [{ id: "m1" }] }];
    expect(await createThread("chart")).toEqual({
      ok: true,
      threadId: "thread-new",
    });
    expect(fake.inserts).toHaveLength(1);
  });

  it("still creates a thread when the empty-thread lookup fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fake.threadListError = { code: "XX000" };
    expect(await createThread("chart")).toEqual({
      ok: true,
      threadId: "thread-new",
    });
    expect(fake.inserts).toHaveLength(1);
  });

  it("does not look for a reusable thread when there is no chart", async () => {
    fake.profile = null;
    expect(await createThread("chart")).toEqual({
      ok: false,
      code: "no_chart",
    });
    expect(fake.threadFilters).toEqual([]);
  });

  it("maps an ended relationship to not_connected and other errors to error", async () => {
    fake.createdThread = null;
    fake.createError = { code: "AP001" };
    expect(await createThread("relationship")).toEqual({
      ok: false,
      code: "not_connected",
    });
    fake.createError = { code: "XX000" };
    expect(await createThread("chart")).toEqual({ ok: false, code: "error" });
  });
});

describe("listThreads and getThread", () => {
  it("lists threads as summaries", async () => {
    fake.threadList = [chartThread(), relationshipThread({ id: "thread-2" })];
    expect(await listThreads()).toEqual([
      {
        id: "thread-1",
        type: "chart",
        title: "About my chart",
        updatedAt: "2026-09-30T10:00:00Z",
      },
      {
        id: "thread-2",
        type: "relationship",
        title: "About us",
        updatedAt: "2026-09-30T10:00:00Z",
      },
    ]);
  });

  it("returns null when the thread is not visible", async () => {
    fake.thread = null;
    expect(await getThread("thread-1")).toBeNull();
    fake.thread = chartThread();
    fake.threadError = { code: "22P02" };
    expect(await getThread("not-a-uuid")).toBeNull();
  });

  it("returns the thread with its messages, oldest first", async () => {
    fake.messages = [
      { id: "m1", role: "user", content: "Q", created_at: "t1" },
      { id: "m2", role: "assistant", content: "A", created_at: "t2" },
    ];
    expect(await getThread("thread-1")).toEqual({
      thread: {
        id: "thread-1",
        type: "chart",
        title: "About my chart",
        updatedAt: "2026-09-30T10:00:00Z",
      },
      messages: [
        { id: "m1", role: "user", content: "Q", createdAt: "t1" },
        { id: "m2", role: "assistant", content: "A", createdAt: "t2" },
      ],
    });
  });
});

describe("getRemainingQuestions", () => {
  it("is the limit minus recent questions, never below zero", async () => {
    fake.usageCount = 12;
    expect(await getRemainingQuestions()).toBe(18);
    expect(usage.countRecentUsage).toHaveBeenCalledWith({
      userId: "user-1",
      kind: "question",
    });
    fake.usageCount = 45;
    expect(await getRemainingQuestions()).toBe(0);
  });
});

describe("titleFromQuestion", () => {
  it("keeps short questions and cuts long ones at a word with three dots", () => {
    expect(titleFromQuestion("  What drives me?  ")).toBe("What drives me?");
    const sixty = "a".repeat(60);
    expect(titleFromQuestion(sixty)).toBe(sixty);
    const long =
      "What does my Venus placement say about the way that I show love to people";
    const title = titleFromQuestion(long);
    expect(title).toBe(
      "What does my Venus placement say about the way that I...",
    );
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith("...")).toBe(true);
    expect(titleFromQuestion("x".repeat(100))).toBe(`${"x".repeat(57)}...`);
  });
});

describe("askQuestion", () => {
  it("rejects an empty or too long question without reading anything", async () => {
    expect(await askQuestion("thread-1", "   ")).toEqual({
      ok: false,
      code: "error",
    });
    expect(await askQuestion("thread-1", "x".repeat(501))).toEqual({
      ok: false,
      code: "error",
    });
    expect(fake.chatCalls).toHaveLength(0);
    expect(fake.inserts).toHaveLength(0);
  });

  it("returns not_found for an invisible thread, with no provider call", async () => {
    fake.thread = null;
    expect(await askQuestion("thread-1", "What drives me?")).toEqual({
      ok: false,
      code: "not_found",
    });
    expect(fake.chatCalls).toHaveLength(0);
    expect(fake.inserts).toHaveLength(0);
  });

  it("returns not_connected when the relationship ended or changed", async () => {
    fake.thread = relationshipThread();
    fake.context = null;
    expect(await askQuestion("thread-1", "How do we get on?")).toEqual({
      ok: false,
      code: "not_connected",
    });
    fake.context = makeContext({ relationshipId: "rel-2" });
    expect(await askQuestion("thread-1", "How do we get on?")).toEqual({
      ok: false,
      code: "not_connected",
    });
    expect(fake.chatCalls).toHaveLength(0);
    expect(fake.inserts).toHaveLength(0);
  });

  it("stores the fixed crisis reply with no provider call, usage or limit use", async () => {
    // Even with the limit reached and the AI offline.
    fake.usageCount = 30;
    fake.providerThrows = new AiUnavailableError("offline");
    expect(await askQuestion("thread-1", "I want to kill myself")).toEqual({
      ok: true,
    });
    expect(fake.chatCalls).toHaveLength(0);
    expect(usage.recordUsage).not.toHaveBeenCalled();
    expect(usage.countRecentUsage).not.toHaveBeenCalled();
    const [user, assistant] = storedRows();
    expect(user).toMatchObject({ role: "user" });
    expect(assistant).toMatchObject({
      role: "assistant",
      content: CRISIS_REPLY,
      model: "safety",
      prompt_version: ASSISTANT_PROMPT_VERSION,
    });
    // The crisis question never becomes the thread title.
    expect(fake.updates[0].values).not.toHaveProperty("title");
  });

  it("stores a crisis reply on a relationship thread too", async () => {
    fake.thread = relationshipThread();
    expect(await askQuestion("thread-1", "He hits me when we argue")).toEqual({
      ok: true,
    });
    expect(storedRows()[1]).toMatchObject({ content: CRISIS_REPLY });
    expect(fake.chatCalls).toHaveLength(0);
  });

  it("returns limit when reached, storing nothing and not calling the provider", async () => {
    fake.usageCount = 30;
    expect(await askQuestion("thread-1", "What drives me?")).toEqual({
      ok: false,
      code: "limit",
    });
    expect(fake.chatCalls).toHaveLength(0);
    expect(fake.inserts).toHaveLength(0);
    expect(usage.recordUsage).not.toHaveBeenCalled();
  });

  it("returns no_chart when the viewer has no chart", async () => {
    fake.profile = null;
    expect(await askQuestion("thread-1", "What drives me?")).toEqual({
      ok: false,
      code: "no_chart",
    });
    fake.thread = relationshipThread();
    fake.context = makeContext({ chartsMissing: true, synastry: null });
    expect(await askQuestion("thread-1", "How do we get on?")).toEqual({
      ok: false,
      code: "no_chart",
    });
    expect(fake.inserts).toHaveLength(0);
  });

  it("stores both messages with model, prompt version and tokens, and records usage", async () => {
    fake.replies = [answer(SUPPORTED, 321, 123)];
    const before = Date.now();
    expect(await askQuestion("thread-1", "  What drives me?  ")).toEqual({
      ok: true,
    });

    expect(adminInserts()).toHaveLength(1);
    const [user, assistant] = storedRows();
    expect(user).toMatchObject({
      thread_id: "thread-1",
      role: "user",
      content: "What drives me?",
    });
    expect(assistant).toMatchObject({
      thread_id: "thread-1",
      role: "assistant",
      content: SUPPORTED,
      model: "test-model",
      prompt_version: ASSISTANT_PROMPT_VERSION,
      input_tokens: 321,
      output_tokens: 123,
    });
    const times = [user, assistant].map((r) =>
      Date.parse(r.created_at as string),
    );
    expect(times[0]).toBeGreaterThanOrEqual(before);
    expect(times[1]).toBeGreaterThan(times[0]);

    expect(fake.chatCalls).toHaveLength(1);
    expect(fake.chatCalls[0].opts).toEqual({
      maxTokens: 500,
      timeoutMs: 50000,
    });
    expect(usage.recordUsage).toHaveBeenCalledTimes(1);
    expect(usage.recordUsage).toHaveBeenCalledWith({
      userId: "user-1",
      relationshipId: null,
      kind: "question",
      model: "test-model",
      promptVersion: ASSISTANT_PROMPT_VERSION,
      usage: { inputTokens: 321, outputTokens: 123 },
      attempt: 1,
    });
    expect(fake.updates).toEqual([
      {
        table: "ai_threads",
        values: {
          updated_at: assistant.created_at,
          title: "What drives me?",
        },
        id: "thread-1",
      },
    ]);
  });

  it("sets the title from the first question only", async () => {
    fake.replies = [answer(SUPPORTED)];
    await askQuestion(
      "thread-1",
      "What does my Venus placement say about the way that I show love to people",
    );
    expect(fake.updates[0].values.title).toBe(
      "What does my Venus placement say about the way that I...",
    );

    fake.updates = [];
    fake.thread = chartThread({ title: "What drives me?" });
    fake.replies = [answer(SUPPORTED)];
    await askQuestion("thread-1", "And my Moon?");
    expect(fake.updates[0].values).not.toHaveProperty("title");
  });

  it("passes the last 10 stored messages, oldest first, as history", async () => {
    fake.thread = chartThread({ title: "Earlier question" });
    fake.messages = Array.from({ length: 14 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i}`,
      created_at: `2026-09-30T10:00:${String(i).padStart(2, "0")}Z`,
    }));
    fake.replies = [answer(SUPPORTED)];
    await askQuestion("thread-1", "And my Moon?");
    const turns = fake.chatCalls[0].messages.filter((m) => m.role !== "system");
    expect(turns.map((m) => m.content)).toEqual([
      ...Array.from({ length: 10 }, (_, i) => `message ${i + 4}`),
      "And my Moon?",
    ]);
  });

  describe("history and crisis exchanges", () => {
    const stored = (
      i: number,
      role: "user" | "assistant",
      content: string,
      model: string | null = role === "assistant" ? "test-model" : null,
    ): StoredRow => ({
      id: `m${i}`,
      role,
      content,
      model,
      created_at: `2026-09-30T10:00:${String(i).padStart(2, "0")}Z`,
    });
    const turnsSent = () =>
      fake.chatCalls[0].messages
        .filter((m) => m.role !== "system")
        .map((m) => m.content);

    it("never sends an earlier crisis question or the fixed reply to the model", async () => {
      fake.thread = chartThread({ title: "Earlier question" });
      fake.messages = [
        stored(0, "user", "What drives me?"),
        stored(1, "assistant", "You are driven."),
        stored(2, "user", "I want to kill myself"),
        stored(3, "assistant", CRISIS_REPLY, "safety"),
      ];
      fake.replies = [answer(SUPPORTED)];
      await askQuestion("thread-1", "And my Moon?");
      expect(turnsSent()).toEqual([
        "What drives me?",
        "You are driven.",
        "And my Moon?",
      ]);
      expect(joined(fake.chatCalls[0].messages)).not.toContain("kill myself");
      // The system prompt quotes the reply, so only the turns are checked.
      expect(turnsSent()).not.toContain(CRISIS_REPLY);
    });

    it("drops each crisis exchange but keeps ordinary history on either side", async () => {
      fake.thread = chartThread({ title: "Earlier question" });
      fake.messages = [
        stored(0, "user", "first"),
        stored(1, "assistant", "first answer"),
        stored(2, "user", "He hits me"),
        stored(3, "assistant", CRISIS_REPLY, "safety"),
        stored(4, "user", "second"),
        stored(5, "assistant", "second answer"),
        stored(6, "user", "I do not want to live"),
        stored(7, "assistant", CRISIS_REPLY, "safety"),
      ];
      fake.replies = [answer(SUPPORTED)];
      await askQuestion("thread-1", "third");
      expect(turnsSent()).toEqual([
        "first",
        "first answer",
        "second",
        "second answer",
        "third",
      ]);
    });

    it("counts the last 10 turns after the crisis exchanges are removed", async () => {
      fake.thread = chartThread({ title: "Earlier question" });
      const rows: StoredRow[] = [];
      // 12 ordinary turns, with two crisis exchanges mixed in among the newest.
      for (let i = 0; i < 12; i++) {
        rows.push(
          stored(
            rows.length,
            i % 2 === 0 ? "user" : "assistant",
            `message ${i}`,
          ),
        );
        if (i === 8 || i === 10) {
          rows.push(stored(rows.length, "user", `crisis ${i}`));
          rows.push(stored(rows.length, "assistant", CRISIS_REPLY, "safety"));
        }
      }
      fake.messages = rows;
      fake.replies = [answer(SUPPORTED)];
      await askQuestion("thread-1", "And my Moon?");
      expect(turnsSent()).toEqual([
        ...Array.from({ length: 10 }, (_, i) => `message ${i + 2}`),
        "And my Moon?",
      ]);
    });

    it("keeps a stored crisis exchange visible in the thread", async () => {
      fake.thread = chartThread({ title: "Earlier question" });
      fake.messages = [
        stored(0, "user", "I want to kill myself"),
        stored(1, "assistant", CRISIS_REPLY, "safety"),
      ];
      fake.replies = [answer(SUPPORTED)];
      await askQuestion("thread-1", "And my Moon?");
      expect(turnsSent()).toEqual(["And my Moon?"]);
      // Nothing was deleted or rewritten: only the new exchange is added.
      expect(storedRows()).toHaveLength(2);
      expect(fake.messages).toHaveLength(2);
    });
  });

  it("retries once after an unsupported claim and stores the second answer", async () => {
    fake.replies = [answer(UNSUPPORTED, 100, 50), answer(SUPPORTED, 110, 60)];
    expect(await askQuestion("thread-1", "What drives me?")).toEqual({
      ok: true,
    });
    expect(fake.chatCalls).toHaveLength(2);
    const retryText = joined(fake.chatCalls[1].messages);
    expect(retryText).toContain(
      "Your previous answer mentioned placements that are not in the facts. Answer again using only the facts.",
    );
    // The retry names what was rejected, in the model's own words.
    expect(retryText).toContain('"Your Sun in the 13th house"');
    expect(retryText).toContain(
      "Use only the aspects and placements listed in the facts.",
    );
    expect(joined(fake.chatCalls[0].messages)).not.toContain(
      "Your previous answer mentioned",
    );
    expect(storedRows()[1]).toMatchObject({
      content: SUPPORTED,
      input_tokens: 110,
      output_tokens: 60,
    });
    expect(recordedAttempts()).toEqual([1, 2]);
  });

  it("stores the fallback when both answers have unsupported claims", async () => {
    fake.replies = [answer(UNSUPPORTED), answer(UNSUPPORTED)];
    expect(await askQuestion("thread-1", "What drives me?")).toEqual({
      ok: true,
    });
    expect(storedRows()[1]).toMatchObject({
      role: "assistant",
      content:
        "I couldn't answer that reliably from your chart facts. Try asking in a different way.",
      model: "test-model",
      prompt_version: ASSISTANT_PROMPT_VERSION,
    });
    expect(recordedAttempts()).toEqual([1, 2]);
  });

  describe("policy filter", () => {
    const ADVICE = "Honestly, you should leave him.";
    const PREDICTION = "The relationship will end badly.";
    const POLICY_LINE =
      "Your previous answer contained advice or predictions that astrology cannot support. Answer again without telling the person what to do, predicting outcomes, scoring, or diagnosing; offer reflective questions instead.";
    const PLACEMENT_OPENING =
      "Your previous answer mentioned placements that are not in the facts. Answer again using only the facts.";
    const PLACEMENT_LINE = expect.stringContaining(PLACEMENT_OPENING);
    const systemLines = (messages: AiMessage[]) =>
      messages.filter((m) => m.role === "system").map((m) => m.content);
    const indexOfLine = (lines: string[], opening: string) =>
      lines.findIndex((line) => line.startsWith(opening));

    it("retries once after advice and stores the clean second answer", async () => {
      fake.replies = [answer(ADVICE, 100, 50), answer(SUPPORTED, 110, 60)];
      expect(await askQuestion("thread-1", "What drives me?")).toEqual({
        ok: true,
      });
      expect(fake.chatCalls).toHaveLength(2);
      expect(systemLines(fake.chatCalls[0].messages)).not.toContain(
        POLICY_LINE,
      );
      const retry = systemLines(fake.chatCalls[1].messages);
      expect(retry).toContain(POLICY_LINE);
      expect(retry).not.toContainEqual(PLACEMENT_LINE);
      // The user's question stays last.
      const last = fake.chatCalls[1].messages.at(-1);
      expect(last).toEqual({ role: "user", content: "What drives me?" });
      expect(storedRows()[1]).toMatchObject({
        content: SUPPORTED,
        input_tokens: 110,
        output_tokens: 60,
      });
      expect(recordedAttempts()).toEqual([1, 2]);
    });

    it("stores the fallback when both answers break the policy", async () => {
      fake.replies = [answer(ADVICE), answer(PREDICTION)];
      expect(await askQuestion("thread-1", "What drives me?")).toEqual({
        ok: true,
      });
      expect(fake.chatCalls).toHaveLength(2);
      expect(storedRows()[1]).toMatchObject({
        role: "assistant",
        content:
          "I couldn't answer that reliably from your chart facts. Try asking in a different way.",
      });
      expect(recordedAttempts()).toEqual([1, 2]);
    });

    it("does not retry a benign answer", async () => {
      const benign =
        "You may want to talk about how you each handle conflict. Many couples find that patience helps.";
      fake.replies = [answer(benign)];
      await askQuestion("thread-1", "What drives me?");
      expect(fake.chatCalls).toHaveLength(1);
      expect(storedRows()[1].content).toBe(benign);
      expect(recordedAttempts()).toEqual([1]);
    });

    it("sends both corrective lines, in one retry, for a placement and a policy problem", async () => {
      fake.replies = [answer(`${UNSUPPORTED} ${ADVICE}`), answer(SUPPORTED)];
      await askQuestion("thread-1", "What drives me?");
      expect(fake.chatCalls).toHaveLength(2);
      const retry = systemLines(fake.chatCalls[1].messages);
      expect(retry).toContainEqual(PLACEMENT_LINE);
      expect(retry).toContain(POLICY_LINE);
      expect(indexOfLine(retry, PLACEMENT_OPENING)).toBeLessThan(
        retry.indexOf(POLICY_LINE),
      );
      expect(storedRows()[1].content).toBe(SUPPORTED);
      expect(recordedAttempts()).toEqual([1, 2]);
    });

    it("keeps the placement line alone for a placement-only problem", async () => {
      fake.replies = [answer(UNSUPPORTED), answer(SUPPORTED)];
      await askQuestion("thread-1", "What drives me?");
      const retry = systemLines(fake.chatCalls[1].messages);
      expect(retry).toContainEqual(PLACEMENT_LINE);
      expect(retry).not.toContain(POLICY_LINE);
    });

    it("applies on a relationship thread too", async () => {
      fake.thread = relationshipThread();
      fake.replies = [answer("You are 85% compatible."), answer(SUPPORTED)];
      await askQuestion("thread-1", "How do we get on?");
      expect(fake.chatCalls).toHaveLength(2);
      expect(systemLines(fake.chatCalls[1].messages)).toContain(POLICY_LINE);
      expect(storedRows()[1].content).toBe(SUPPORTED);
    });

    it("knows the partner's name on a relationship thread", async () => {
      fake.thread = relationshipThread();
      fake.replies = [answer("You should leave Sam."), answer(SUPPORTED)];
      await askQuestion("thread-1", "How do we get on?");
      expect(fake.chatCalls).toHaveLength(2);
      expect(systemLines(fake.chatCalls[1].messages)).toContain(POLICY_LINE);
      expect(storedRows()[1].content).toBe(SUPPORTED);
    });

    describe("flag tier logging", () => {
      const info = () => vi.spyOn(console, "info").mockImplementation(() => {});

      it("logs category counts for a shown answer, and nothing else", async () => {
        const spy = info();
        fake.thread = relationshipThread();
        // Soft advice: not blocked, so it is shown, and the flag tier reports it.
        fake.replies = [answer("You are better off ending things, Sam.")];
        await askQuestion("thread-1", "How do we get on? secretly");
        expect(fake.chatCalls).toHaveLength(1);
        expect(spy).toHaveBeenCalledTimes(1);
        const [message, details] = spy.mock.calls[0];
        expect(message).toBe("Assistant answer flagged");
        expect(details).toEqual({
          threadId: "thread-1",
          flags: { directive: 1 },
        });
        const logged = JSON.stringify(spy.mock.calls);
        expect(logged).not.toContain("ending things");
        expect(logged).not.toContain("Sam");
        expect(logged).not.toContain("secretly");
      });

      it("logs nothing for a clean answer", async () => {
        const spy = info();
        fake.replies = [answer(SUPPORTED)];
        await askQuestion("thread-1", "What drives me?");
        expect(spy).not.toHaveBeenCalled();
      });

      it("never throws and never changes the outcome when logging fails", async () => {
        vi.spyOn(console, "info").mockImplementation(() => {
          throw new Error("logger down");
        });
        fake.thread = relationshipThread();
        fake.replies = [answer("You are better off ending things, Sam.")];
        expect(await askQuestion("thread-1", "How do we get on?")).toEqual({
          ok: true,
        });
        expect(storedRows()[1].content).toBe(
          "You are better off ending things, Sam.",
        );
      });
    });

    it("never logs the question, the answer or the matched words", async () => {
      fake.replies = [
        answer("Honestly, you should leave him, secretly."),
        answer("Your husband is a narcissist, secretly."),
      ];
      await askQuestion("thread-1", "What drives me secretly?");
      const logged = JSON.stringify(consoleError.mock.calls);
      expect(logged).not.toContain("secretly");
      expect(logged).not.toContain("leave him");
      expect(logged).not.toContain("narcissist");
      // Stage and category codes only.
      expect(logged).toContain("validate-1");
      expect(logged).toContain("policy:directive");
      expect(logged).toContain("policy:diagnosis");
    });
  });

  it("records an invalid output's usage and retries once", async () => {
    fake.replies = [
      new AiInvalidOutputError({ inputTokens: 90, outputTokens: 0 }),
      answer(SUPPORTED),
    ];
    expect(await askQuestion("thread-1", "What drives me?")).toEqual({
      ok: true,
    });
    expect(recordedAttempts()).toEqual([1, 2]);
    expect(vi.mocked(usage.recordUsage).mock.calls[0][0].usage).toEqual({
      inputTokens: 90,
      outputTokens: 0,
    });
    expect(storedRows()[1]).toMatchObject({ content: SUPPORTED });
  });

  it("logs why the output was unusable when the provider says so, and a generic code otherwise", async () => {
    fake.replies = [
      new AiInvalidOutputError(
        { inputTokens: 90, outputTokens: 500 },
        "length",
      ),
      new AiInvalidOutputError({ inputTokens: 91, outputTokens: 0 }),
    ];
    await askQuestion("thread-1", "What drives me?");
    const codes = (
      consoleError.mock.calls as [string, Record<string, string>][]
    )
      .filter(([message]) => message === "Assistant failed")
      .map(([, details]) => [details.stage, details.code]);
    expect(codes).toEqual([
      ["validate-1", "length"],
      ["validate-2", "invalid_output"],
    ]);
  });

  it("stores the fallback when both calls return invalid output", async () => {
    fake.replies = [
      new AiInvalidOutputError({ inputTokens: 90, outputTokens: 0 }),
      new AiInvalidOutputError({ inputTokens: 91, outputTokens: 0 }),
    ];
    expect(await askQuestion("thread-1", "What drives me?")).toEqual({
      ok: true,
    });
    expect(storedRows()[1]).toMatchObject({
      content: expect.stringContaining("I couldn't answer that reliably"),
    });
    expect(recordedAttempts()).toEqual([1, 2]);
  });

  it("adds the sensitive system message for a sensitive question", async () => {
    fake.replies = [answer(SUPPORTED), answer(SUPPORTED)];
    await askQuestion("thread-1", "Will we have money problems?");
    expect(
      fake.chatCalls[0].messages.some(
        (m) => m.role === "system" && m.content === SENSITIVE_INSTRUCTION,
      ),
    ).toBe(true);
    await askQuestion("thread-1", "What drives me?");
    expect(
      fake.chatCalls[1].messages.some(
        (m) => m.content === SENSITIVE_INSTRUCTION,
      ),
    ).toBe(false);
  });

  it("returns ai_unavailable and stores nothing when the AI is offline", async () => {
    fake.replies = [new AiUnavailableError("offline")];
    expect(await askQuestion("thread-1", "What drives me?")).toEqual({
      ok: false,
      code: "ai_unavailable",
    });
    expect(fake.inserts).toHaveLength(0);
    expect(usage.recordUsage).not.toHaveBeenCalled();

    fake.providerThrows = new AiUnavailableError("disabled");
    expect(await askQuestion("thread-1", "What drives me?")).toEqual({
      ok: false,
      code: "ai_unavailable",
    });
    expect(fake.inserts).toHaveLength(0);
  });

  it.each(["timeout", "model_missing", "error"] as const)(
    "returns ai_unavailable and stores nothing when the model fails with %s",
    async (reason) => {
      fake.replies = [new AiUnavailableError(reason)];
      expect(await askQuestion("thread-1", "What drives me?")).toEqual({
        ok: false,
        code: "ai_unavailable",
      });
      // One call only: an unavailable model is not retried.
      expect(fake.chatCalls).toHaveLength(1);
      expect(fake.inserts).toHaveLength(0);
      expect(usage.recordUsage).not.toHaveBeenCalled();
      // The log names the reason and nothing else about the question.
      expect(consoleError).toHaveBeenCalledWith("Assistant failed", {
        threadId: "thread-1",
        stage: "generate",
        code: reason,
      });
    },
  );

  it("returns error, without calling the model, when usage cannot be counted", async () => {
    // Also what happens when SUPABASE_SECRET_KEY is missing: the admin client throws.
    vi.mocked(usage.countRecentUsage).mockRejectedValueOnce(
      new Error("SUPABASE_SECRET_KEY is not set"),
    );
    expect(await askQuestion("thread-1", "What drives me?")).toEqual({
      ok: false,
      code: "error",
    });
    expect(fake.chatCalls).toHaveLength(0);
    expect(fake.inserts).toHaveLength(0);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "SUPABASE_SECRET_KEY",
    );
  });

  it("maps a store failure to not_connected, not_found or error without leaking", async () => {
    fake.replies = [answer(SUPPORTED)];
    fake.insertError = { code: "AP001" };
    expect(await askQuestion("thread-1", "What drives me?")).toEqual({
      ok: false,
      code: "not_connected",
    });
    fake.replies = [answer(SUPPORTED)];
    fake.insertError = { code: "23503" };
    expect(await askQuestion("thread-1", "What drives me?")).toEqual({
      ok: false,
      code: "not_found",
    });
    fake.replies = [answer(SUPPORTED)];
    fake.insertError = { code: "XX000" };
    expect(await askQuestion("thread-1", "What drives me?")).toEqual({
      ok: false,
      code: "error",
    });
    for (const [, details] of consoleError.mock.calls)
      expect(Object.keys(details as object).sort()).toEqual([
        "code",
        "stage",
        "threadId",
      ]);
  });

  it("maps a thread update that hits an ended relationship to not_connected", async () => {
    fake.replies = [answer(SUPPORTED)];
    fake.updateError = { code: "AP001" };
    expect(await askQuestion("thread-1", "What drives me?")).toEqual({
      ok: false,
      code: "not_connected",
    });
  });

  it("never logs the question or the answer", async () => {
    fake.replies = [answer(UNSUPPORTED), answer(UNSUPPORTED)];
    await askQuestion("thread-1", "What drives me secretly?");
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain("secretly");
    expect(logged).not.toContain("13th house");
  });

  describe("analytics", () => {
    const tracked = () => vi.mocked(analytics.trackAfterResponse).mock.calls;

    it("tracks one ai_question_asked for an answer that came from the model", async () => {
      fake.replies = [answer(SUPPORTED)];
      await askQuestion("thread-1", "What drives me?");
      expect(tracked()).toEqual([["ai_question_asked", "user-1"]]);
    });

    it("tracks once, not per attempt, when the model needed a retry", async () => {
      fake.replies = [answer(UNSUPPORTED), answer(SUPPORTED)];
      await askQuestion("thread-1", "What drives me?");
      expect(tracked()).toEqual([["ai_question_asked", "user-1"]]);
    });

    it("tracks the fixed fallback answer, which still went to the model", async () => {
      fake.replies = [answer(UNSUPPORTED), answer(UNSUPPORTED)];
      await askQuestion("thread-1", "What drives me?");
      expect(tracked()).toEqual([["ai_question_asked", "user-1"]]);
    });

    it("tracks a relationship question too", async () => {
      fake.thread = relationshipThread();
      fake.replies = [answer(SUPPORTED)];
      await askQuestion("thread-1", "How do we get on?");
      expect(tracked()).toEqual([["ai_question_asked", "user-1"]]);
    });

    it("does not track a crisis reply", async () => {
      await askQuestion("thread-1", "I want to kill myself");
      expect(tracked()).toHaveLength(0);
    });

    it("does not track a limit, an unavailable AI or a missing chart", async () => {
      fake.usageCount = 30;
      await askQuestion("thread-1", "What drives me?");
      fake.usageCount = 0;
      fake.replies = [new AiUnavailableError("offline")];
      await askQuestion("thread-1", "What drives me?");
      fake.profile = null;
      await askQuestion("thread-1", "What drives me?");
      expect(tracked()).toHaveLength(0);
    });

    it("does not track a question that could not be stored", async () => {
      fake.replies = [answer(SUPPORTED)];
      fake.insertError = { code: "XX000" };
      await askQuestion("thread-1", "What drives me?");
      expect(tracked()).toHaveLength(0);
    });

    it("does not track an invalid question or an invisible thread", async () => {
      await askQuestion("thread-1", "   ");
      fake.thread = null;
      await askQuestion("thread-1", "What drives me?");
      expect(tracked()).toHaveLength(0);
    });

    it("sends only the event name and the user id, never question or answer text", async () => {
      fake.replies = [answer(SUPPORTED)];
      await askQuestion("thread-1", "What drives me secretly?");
      const sent = JSON.stringify(tracked());
      expect(sent).not.toContain("secretly");
      expect(sent).not.toContain("thoughtful");
    });
  });

  describe("relationship threads", () => {
    beforeEach(() => {
      fake.thread = relationshipThread();
    });

    it("builds a prompt with no birth input and none of the partner's chart details", async () => {
      fake.reportState = { kind: "none" };
      fake.replies = [answer(SUPPORTED)];
      expect(await askQuestion("thread-1", "How do we get on?")).toEqual({
        ok: true,
      });
      const prompt = joined(fake.chatCalls[0].messages);
      for (const secret of BIRTH_SECRETS) expect(prompt).not.toContain(secret);
      // The partner's own placements with degrees and houses are not sent.
      for (const line of buildNatalFacts(partner).lines)
        expect(prompt).not.toContain(line);
      // The viewer's own chart facts and the partner's sign-level facts are.
      for (const line of buildNatalFacts(own).lines)
        expect(prompt).toContain(line);
      expect(prompt).toContain("Sam's Sun in");
      expect(usage.recordUsage).toHaveBeenCalledWith(
        expect.objectContaining({ relationshipId: "rel-1", attempt: 1 }),
      );
    });

    it("orients the facts for a viewer who is side b", async () => {
      fake.context = makeContext({
        viewerUserId: "user-3",
        partnerUserId: "user-2",
        viewerIsA: false,
        // Canonical: a is the partner, b is the viewer.
        synastry: calculateSynastry(partner, own),
        synastryKey: synastryKey(partner, own),
      });
      fake.replies = [answer(SUPPORTED)];
      await askQuestion("thread-1", "How do we get on?");
      const prompt = joined(fake.chatCalls[0].messages);
      const expected = buildRelationshipFacts({
        names: { a: "Me", b: "Sam" },
        a: summarizeChart(own, "Me"),
        b: summarizeChart(partner, "Sam"),
        synastry: calculateSynastry(own, partner),
      }).evidence.filter(
        (e) => e.id.startsWith("syn:") || e.id.startsWith("ovl:"),
      );
      expect(expected.length).toBeGreaterThan(0);
      for (const { label } of expected) expect(prompt).toContain(label);
    });

    it("includes the summaries of an up-to-date report only", async () => {
      fake.reportState = {
        kind: "ready",
        outOfDate: false,
        report: {
          interpretation: {
            sections: Object.fromEntries(
              [
                "overview",
                "emotional",
                "communication",
                "affection",
                "attraction",
                "conflict",
                "strengths",
                "friction",
                "growth",
              ].map((k) => [k, { summary: `Summary for ${k}.` }]),
            ),
          },
        },
      };
      fake.replies = [answer(SUPPORTED), answer(SUPPORTED)];
      await askQuestion("thread-1", "How do we get on?");
      expect(joined(fake.chatCalls[0].messages)).toContain(
        "Summary for communication.",
      );

      fake.reportState = {
        ...(fake.reportState as object),
        outOfDate: true,
      };
      await askQuestion("thread-1", "How do we get on?");
      expect(joined(fake.chatCalls[1].messages)).not.toContain(
        "Summary for communication.",
      );
    });

    it("carries on without summaries when the report cannot be read", async () => {
      fake.reportThrows = true;
      fake.replies = [answer(SUPPORTED)];
      expect(await askQuestion("thread-1", "How do we get on?")).toEqual({
        ok: true,
      });
    });

    it("accepts 'your' and 'their' as owners in the guard", async () => {
      const viewerSun = own.placements.find((p) => p.body === "sun")!.sign;
      const partnerMoon = summarizeChart(partner, "Sam").signs!.find(
        (s) => s.body === "moon",
      )!.sign;
      fake.replies = [
        answer(
          `Your Sun in ${viewerSun[0].toUpperCase()}${viewerSun.slice(1)} and their Moon in ${partnerMoon} meet here.`,
        ),
      ];
      await askQuestion("thread-1", "How do we get on?");
      expect(fake.chatCalls).toHaveLength(1);
      expect(storedRows()[1].content).toContain("meet here");
    });

    it("flags a swapped owner and falls back after the retry", async () => {
      const viewerSun = own.placements.find((p) => p.body === "sun")!.sign;
      const partnerSun = partner.placements.find((p) => p.body === "sun")!.sign;
      // Only meaningful when the two Suns differ.
      expect(viewerSun).not.toBe(partnerSun);
      const swapped = `Their Sun in ${viewerSun[0].toUpperCase()}${viewerSun.slice(1)} is warm.`;
      fake.replies = [answer(swapped), answer(swapped)];
      await askQuestion("thread-1", "How do we get on?");
      expect(storedRows()[1].content).toContain("I couldn't answer that");
    });

    it("returns error when the relationship data failed to load", async () => {
      fake.context = makeContext({ error: true });
      expect(await askQuestion("thread-1", "How do we get on?")).toEqual({
        ok: false,
        code: "error",
      });
    });
  });
});
