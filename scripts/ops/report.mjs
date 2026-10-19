// Private beta ops report: the signup funnel and AI usage.
// Run with `pnpm ops:report` (add `-- --json` for machine-readable output).
//
// Reads analytics_events and ai_usage_events with the secret key from .env, so
// it runs on your machine only. It prints counts and never prints keys, user
// references or any per-person data.

import { createClient } from "@supabase/supabase-js";
import {
  AI_DAYS,
  DAY_MS,
  FUNNEL_DAYS,
  buildReport,
  table,
} from "./lib/report-core.mjs";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env file: the variables may already be in the environment.
}

const PAGE_SIZE = 1000;

class ReportError extends Error {}

function fail(message) {
  console.error(`ops:report: ${message}`);
  process.exitCode = 1;
}

/** Reads every row of a table query, page by page, in id order. */
async function fetchAll(client, table, columns, since) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = client.from(table).select(columns).order("id");
    if (since) query = query.gte("created_at", since);
    const { data, error, status } = await query.range(
      from,
      from + PAGE_SIZE - 1,
    );
    if (error && status === 0) {
      // The request never got an answer (offline, wrong URL).
      throw new ReportError(
        `could not reach Supabase while reading ${table}. Check your network and NEXT_PUBLIC_SUPABASE_URL.`,
      );
    }
    if (error) {
      const hint =
        error.code === "PGRST205" || error.code === "42P01"
          ? " Has the Sprint 5 hardening migration been applied?"
          : "";
      throw new ReportError(
        `could not read ${table} (code ${error.code || "unknown"}).${hint}`,
      );
    }
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

const pct = (n, approximate) =>
  n === null ? "-" : `${approximate ? "~" : ""}${n}%`;

function printReport(report) {
  console.log(`AstraPair ops report (${report.generatedAt})\n`);
  console.log(`Funnel: distinct people per event`);
  console.log(
    table(
      ["event", "all time", `last ${FUNNEL_DAYS}d`, "vs previous", "vs signup"],
      report.funnel.map((s) => [
        s.event,
        s.allTime,
        s.last30Days,
        pct(s.fromPreviousPercent, s.approximate),
        pct(s.fromRegistrationPercent, s.approximate),
      ]),
    ),
  );
  console.log(
    "~ approximate: the invitee records partner_connected and the inviter records partner_invited, so those steps compare different people.",
  );
  const usageHeaders = ["calls", "retries", "input tokens", "output tokens"];
  const usageRow = (name) => (u) => [
    u[name],
    u.calls,
    u.retries,
    u.inputTokens,
    u.outputTokens,
  ];
  console.log(
    `\nAI usage by day, last ${AI_DAYS} days (calls are first attempts; retries are extra attempts)`,
  );
  console.log(
    report.aiUsage.byDay.length
      ? table(
          ["day", ...usageHeaders],
          report.aiUsage.byDay.map(usageRow("day")),
        )
      : "No AI calls in this period.",
  );
  console.log(`\nAI usage by model, last ${AI_DAYS} days`);
  console.log(
    report.aiUsage.byModel.length
      ? table(
          ["model", ...usageHeaders],
          report.aiUsage.byModel.map(usageRow("model")),
        )
      : "No AI calls in this period.",
  );
}

async function main() {
  const json = process.argv.includes("--json");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    return fail(
      "set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env first.",
    );
  }
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = Date.now();
  const events = await fetchAll(
    client,
    "analytics_events",
    "id, event, user_ref, created_at",
  );
  const usage = await fetchAll(
    client,
    "ai_usage_events",
    "id, model, attempt, input_tokens, output_tokens, created_at",
    new Date(now - AI_DAYS * DAY_MS).toISOString(),
  );

  const report = buildReport(events, usage, now);

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
}

main().catch((e) => {
  // Fixed text only: the error may carry request details.
  fail(
    e instanceof ReportError
      ? e.message
      : `unexpected error (${e?.name ?? "Error"}).`,
  );
});
