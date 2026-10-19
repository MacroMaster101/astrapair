import { describe, expect, it } from "vitest";
import {
  buildFunnel,
  buildReport,
  groupUsage,
  percent,
  table,
} from "../../../scripts/ops/lib/report-core.mjs";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const ev = (event: string, ref: string, age: number) => ({
  event,
  user_ref: ref,
  created_at: daysAgo(age),
});

type Step = {
  event: string;
  allTime: number;
  last30Days: number;
  fromPreviousPercent: number | null;
  fromRegistrationPercent: number | null;
  approximate: boolean;
};
const stepOf = (funnel: Step[], event: string) =>
  funnel.find((s) => s.event === event)!;

describe("percent", () => {
  it("rounds to one decimal and is null for an empty whole", () => {
    expect(percent(2, 3)).toBe(66.7);
    expect(percent(1, 2)).toBe(50);
    expect(percent(0, 0)).toBeNull();
  });
});

describe("buildFunnel", () => {
  const events = [
    ev("registration", "a", 1),
    ev("registration", "b", 40),
    ev("registration", "c", 2),
    ev("birth_profile_completed", "a", 1),
    ev("birth_profile_completed", "b", 40),
    // The same person twice counts once.
    ev("chart_generated", "a", 1),
    ev("chart_generated", "a", 3),
    ev("account_deleted", "c", 0),
  ];
  const funnel: Step[] = buildFunnel(events, NOW);

  it("counts distinct people all time and over the last 30 days", () => {
    expect(stepOf(funnel, "registration")).toMatchObject({
      allTime: 3,
      last30Days: 2,
    });
    expect(stepOf(funnel, "chart_generated")).toMatchObject({
      allTime: 1,
      last30Days: 1,
    });
  });

  it("lists every event, with zero for the ones nobody reached", () => {
    expect(funnel.map((s) => s.event)).toEqual([
      "registration",
      "birth_profile_completed",
      "chart_generated",
      "partner_invited",
      "partner_connected",
      "report_generated",
      "ai_question_asked",
      "account_deleted",
    ]);
    expect(stepOf(funnel, "partner_invited").allTime).toBe(0);
    expect(stepOf(funnel, "account_deleted").allTime).toBe(1);
  });

  it("computes conversion against the previous step and against registration", () => {
    expect(stepOf(funnel, "registration")).toMatchObject({
      fromPreviousPercent: null,
      fromRegistrationPercent: null,
    });
    expect(stepOf(funnel, "birth_profile_completed")).toMatchObject({
      fromPreviousPercent: 66.7,
      fromRegistrationPercent: 66.7,
    });
    expect(stepOf(funnel, "chart_generated")).toMatchObject({
      fromPreviousPercent: 50,
      fromRegistrationPercent: 33.3,
    });
    // Nobody reached the previous step: no ratio.
    expect(stepOf(funnel, "partner_connected").fromPreviousPercent).toBeNull();
  });

  it("marks the partner steps approximate and nothing else", () => {
    expect(funnel.filter((s) => s.approximate).map((s) => s.event)).toEqual([
      "partner_connected",
      "report_generated",
    ]);
  });

  it("includes an event exactly 30 days old and excludes an older one", () => {
    const edge = buildFunnel(
      [ev("registration", "a", 30), ev("registration", "b", 30.01)],
      NOW,
    );
    expect(stepOf(edge, "registration")).toMatchObject({
      allTime: 2,
      last30Days: 1,
    });
  });
});

describe("groupUsage", () => {
  const rows = [
    {
      model: "m1",
      attempt: 1,
      input_tokens: 100,
      output_tokens: 50,
      created_at: daysAgo(1),
    },
    {
      model: "m1",
      attempt: 2,
      input_tokens: 90,
      output_tokens: 40,
      created_at: daysAgo(1),
    },
    {
      model: "m2",
      attempt: 1,
      input_tokens: 10,
      output_tokens: 5,
      created_at: daysAgo(3),
    },
  ];

  it("counts first attempts as calls and later attempts as retries, by model", () => {
    expect(
      groupUsage(rows, (r: { model: string }) => r.model, "model"),
    ).toEqual([
      { model: "m1", calls: 1, retries: 1, inputTokens: 190, outputTokens: 90 },
      { model: "m2", calls: 1, retries: 0, inputTokens: 10, outputTokens: 5 },
    ]);
  });

  it("groups by UTC day in date order", () => {
    const report = buildReport([], rows, NOW);
    expect(report.aiUsage.byDay.map((d: { day: string }) => d.day)).toEqual([
      "2026-10-07",
      "2026-10-09",
    ]);
    expect(report.aiUsage.byDay[1]).toMatchObject({ calls: 1, retries: 1 });
  });
});

describe("buildReport", () => {
  it("is JSON-safe and carries no per-person references", () => {
    const report = buildReport([ev("registration", "secret-ref", 1)], [], NOW);
    expect(report.generatedAt).toBe("2026-10-10T12:00:00.000Z");
    expect(JSON.stringify(report)).not.toContain("secret-ref");
  });
});

describe("table", () => {
  it("pads the first column left and the rest right, with - for blanks", () => {
    expect(
      table(
        ["a", "bb"],
        [
          ["xxx", 1],
          ["y", null],
        ],
      ),
    ).toBe(["a    bb", "xxx   1", "y     -"].join("\n"));
  });
});
