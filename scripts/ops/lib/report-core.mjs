// Pure report logic for scripts/ops/report.mjs: no I/O, so it can be tested.

// Keep in step with src/lib/analytics/events.ts (a test checks the names).
export const FUNNEL = [
  "registration",
  "birth_profile_completed",
  "chart_generated",
  "partner_invited",
  "partner_connected",
  "report_generated",
  "ai_question_asked",
];
export const OTHER_EVENTS = ["account_deleted"];

export const DAY_MS = 86_400_000;
export const AI_DAYS = 14;
export const FUNNEL_DAYS = 30;

/**
 * partner_invited is recorded for the inviter and partner_connected for the
 * invitee, so conversion figures on these steps compare different people.
 */
const APPROXIMATE_STEPS = new Set(["partner_connected", "report_generated"]);

export const percent = (part, whole) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

export function buildFunnel(events, now) {
  const cutoff = now - FUNNEL_DAYS * DAY_MS;
  const allTime = new Map();
  const recent = new Map();
  for (const { event, user_ref: ref, created_at: at } of events) {
    if (!allTime.has(event)) allTime.set(event, new Set());
    allTime.get(event).add(ref);
    if (Date.parse(at) >= cutoff) {
      if (!recent.has(event)) recent.set(event, new Set());
      recent.get(event).add(ref);
    }
  }
  const count = (map, event) => map.get(event)?.size ?? 0;
  const first = count(allTime, FUNNEL[0]);
  const steps = FUNNEL.map((event, i) => {
    const total = count(allTime, event);
    const previous = i === 0 ? null : count(allTime, FUNNEL[i - 1]);
    return {
      event,
      allTime: total,
      last30Days: count(recent, event),
      fromPreviousPercent: previous === null ? null : percent(total, previous),
      fromRegistrationPercent: i === 0 ? null : percent(total, first),
      approximate: APPROXIMATE_STEPS.has(event),
    };
  });
  const others = OTHER_EVENTS.map((event) => ({
    event,
    allTime: count(allTime, event),
    last30Days: count(recent, event),
    fromPreviousPercent: null,
    fromRegistrationPercent: null,
    approximate: false,
  }));
  return [...steps, ...others];
}

function emptyUsage() {
  return { calls: 0, retries: 0, inputTokens: 0, outputTokens: 0 };
}

/** Calls, retries (attempt 2 and later) and tokens, grouped by a row key. */
export function groupUsage(rows, keyOf, name) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, emptyUsage());
    const g = groups.get(key);
    if (row.attempt > 1) g.retries += 1;
    else g.calls += 1;
    g.inputTokens += row.input_tokens;
    g.outputTokens += row.output_tokens;
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, g]) => ({ [name]: key, ...g }));
}

export function table(headers, rows) {
  const cells = [headers, ...rows].map((r) => r.map((c) => String(c ?? "-")));
  const widths = headers.map((_, i) =>
    Math.max(...cells.map((r) => r[i].length)),
  );
  return cells
    .map((r) =>
      r
        .map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i])))
        .join("  "),
    )
    .join("\n");
}

export function buildReport(events, usage, now) {
  return {
    generatedAt: new Date(now).toISOString(),
    funnel: buildFunnel(events, now),
    aiUsage: {
      byDay: groupUsage(usage, (r) => r.created_at.slice(0, 10), "day"),
      byModel: groupUsage(usage, (r) => r.model, "model"),
    },
  };
}
