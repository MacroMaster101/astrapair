import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Result = {
  data?: unknown;
  count?: number | null;
  error?: { code?: string; message?: string } | null;
};
interface Call {
  table: string;
  op: "select" | "insert";
  args: unknown[];
  filters: Array<[string, unknown[]]>;
}

const fake = vi.hoisted(() => ({
  calls: [] as Call[],
  result: { count: 0, error: null } as Result,
  adminThrows: false,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (fake.adminThrows) throw new Error("SUPABASE_SECRET_KEY is not set");
    const builder = (table: string, op: Call["op"], args: unknown[]) => {
      const call: Call = { table, op, args, filters: [] };
      fake.calls.push(call);
      const b: Record<string, unknown> = {};
      for (const m of ["eq", "gte"]) {
        b[m] = (...a: unknown[]) => {
          call.filters.push([m, a]);
          return b;
        };
      }
      b.then = (
        resolve: (v: Result) => unknown,
        reject: (e: unknown) => unknown,
      ) => Promise.resolve(fake.result).then(resolve, reject);
      return b;
    };
    return {
      from: (table: string) => ({
        select: (...args: unknown[]) => builder(table, "select", args),
        insert: (...args: unknown[]) => builder(table, "insert", args),
      }),
    };
  },
}));

const { countRecentUsage, recordUsage } = await import("./usage");

const NOW = new Date("2026-09-30T12:00:00.000Z");
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  fake.calls = [];
  fake.result = { count: 0, error: null };
  fake.adminThrows = false;
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("countRecentUsage", () => {
  it("counts a user's questions over the last 24 hours", async () => {
    fake.result = { count: 7, data: null, error: null };
    expect(await countRecentUsage({ userId: "user-1", kind: "question" })).toBe(
      7,
    );
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    expect(call.table).toBe("ai_usage_events");
    expect(call.op).toBe("select");
    expect(call.args[1]).toEqual({ count: "exact", head: true });
    expect(call.filters).toEqual([
      ["eq", ["kind", "question"]],
      ["eq", ["user_id", "user-1"]],
      ["eq", ["attempt", 1]],
      ["gte", ["created_at", "2026-09-29T12:00:00.000Z"]],
    ]);
  });

  it("counts a relationship's reports over the last 24 hours", async () => {
    fake.result = { count: 2, data: null, error: null };
    expect(
      await countRecentUsage({ relationshipId: "rel-1", kind: "report" }),
    ).toBe(2);
    expect(fake.calls[0].filters).toEqual([
      ["eq", ["kind", "report"]],
      ["eq", ["relationship_id", "rel-1"]],
      ["eq", ["attempt", 1]],
      ["gte", ["created_at", "2026-09-29T12:00:00.000Z"]],
    ]);
  });

  it("treats a missing count as zero", async () => {
    fake.result = { count: null, data: null, error: null };
    expect(await countRecentUsage({ userId: "user-1", kind: "question" })).toBe(
      0,
    );
  });

  it("throws without the database message when counting fails", async () => {
    fake.result = { error: { code: "XX000", message: "secret detail" } };
    const promise = countRecentUsage({ userId: "user-1", kind: "question" });
    await expect(promise).rejects.toThrow("Failed to count usage");
    await expect(promise).rejects.not.toThrow("secret detail");
  });
});

describe("recordUsage", () => {
  const event = {
    userId: "user-1",
    relationshipId: "rel-1",
    kind: "report" as const,
    model: "qwen2.5:7b",
    promptVersion: "report-v1",
    usage: { inputTokens: 1200, outputTokens: 900 },
  };

  it("inserts one usage event with model, prompt version and tokens", async () => {
    fake.result = { error: null };
    await recordUsage(event);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].table).toBe("ai_usage_events");
    expect(fake.calls[0].op).toBe("insert");
    expect(fake.calls[0].args[0]).toEqual({
      user_id: "user-1",
      relationship_id: "rel-1",
      kind: "report",
      model: "qwen2.5:7b",
      prompt_version: "report-v1",
      input_tokens: 1200,
      output_tokens: 900,
      attempt: 1,
    });
  });

  it("records the attempt number of a retry", async () => {
    await recordUsage({ ...event, attempt: 2 });
    expect(fake.calls[0].args[0]).toMatchObject({ attempt: 2 });
  });

  it("stores token counts as non-negative integers", async () => {
    await recordUsage({
      ...event,
      relationshipId: null,
      kind: "question",
      usage: { inputTokens: -3, outputTokens: Number.NaN },
    });
    expect(fake.calls[0].args[0]).toMatchObject({
      relationship_id: null,
      kind: "question",
      input_tokens: 0,
      output_tokens: 0,
    });
  });

  it("swallows an insert failure and logs only ids and the code", async () => {
    fake.result = {
      error: { code: "23503", message: "Key (user_id)=(secret-1990-07-15)" },
    };
    await expect(recordUsage(event)).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).toContain("23503");
    expect(logged).toContain("user-1");
    expect(logged).not.toContain("secret");
    expect(logged).not.toContain("1990-07-15");
  });

  it("swallows a missing admin configuration", async () => {
    fake.adminThrows = true;
    await expect(recordUsage(event)).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "SUPABASE_SECRET_KEY",
    );
  });
});
