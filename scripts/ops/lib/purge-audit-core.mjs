// Helpers for scripts/ops/purge-audit.mjs: argument parsing, the cutoff date and
// the two database operations. The Supabase client is passed in, so the normal
// test suite (src/lib/ops/purge-audit.test.ts) runs them against a fake and
// never touches a database.

export const DEFAULT_DAYS = 365;
/** The database function refuses anything shorter; the script checks first. */
export const MIN_DAYS = 30;
export const MAX_DAYS = 3650;

export class UsageError extends Error {}

export const USAGE = [
  "usage:",
  "  pnpm ops:purge-audit [--days N] [--dry-run]",
  "",
  `  --days N    remove security log entries older than N days (default ${DEFAULT_DAYS},`,
  `              at least ${MIN_DAYS}, at most ${MAX_DAYS})`,
  "  --dry-run   only count the entries that would be removed; delete nothing",
].join("\n");

function parseDays(raw) {
  if (raw === undefined || !/^\d+$/.test(raw)) {
    throw new UsageError(
      `--days needs a whole number from ${MIN_DAYS} to ${MAX_DAYS}.\n${USAGE}`,
    );
  }
  const days = Number(raw);
  if (days < MIN_DAYS || days > MAX_DAYS) {
    throw new UsageError(
      `--days must be from ${MIN_DAYS} to ${MAX_DAYS}. Shorter retention is refused so a typo cannot wipe the log.\n${USAGE}`,
    );
  }
  return days;
}

/** Turns argv (after the script name) into options, or throws UsageError. */
export function parseArgs(argv) {
  let days = DEFAULT_DAYS;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--days") {
      i += 1;
      days = parseDays(argv[i]);
    } else if (arg.startsWith("--days=")) {
      days = parseDays(arg.slice("--days=".length));
    } else {
      throw new UsageError(`unknown argument ${arg}.\n${USAGE}`);
    }
  }
  return { days, dryRun };
}

/** The moment `days` days before `now`, as an ISO string. */
export function cutoffIso(days, now = new Date()) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

export class OpsError extends Error {}

/** Turns a failed call into a fixed-text error: details may carry request data. */
export function queryError(error, status, doing) {
  if (status === 0) {
    return new OpsError(
      `could not reach Supabase while ${doing}. Check your network and NEXT_PUBLIC_SUPABASE_URL.`,
    );
  }
  const missing =
    error.code === "PGRST202" ||
    error.code === "42883" ||
    error.code === "PGRST205" ||
    error.code === "42P01";
  const hint = missing
    ? " Has the Sprint 5 hardening migration (20261001100000_hardening.sql) been applied?"
    : error.code === "42501"
      ? " The secret key was not allowed to do this. Check SUPABASE_SECRET_KEY."
      : "";
  return new OpsError(
    `could not complete ${doing} (code ${error.code || "unknown"}).${hint}`,
  );
}

/** A missing number is an error: it must never be shown as zero entries. */
function requireCount(value, doing) {
  const count = value === null || value === undefined ? NaN : Number(value);
  if (!Number.isFinite(count)) {
    throw new OpsError(
      `${doing} returned no count, so the result is unknown. Check that the table exists and that NEXT_PUBLIC_SUPABASE_URL is right. Nothing was reported as removed.`,
    );
  }
  return count;
}

/** Counts the entries older than the cutoff. Never calls the purge function. */
export async function dryRun(
  client,
  days,
  log = console.log,
  now = new Date(),
) {
  const { count, error, status } = await client
    .from("audit_events")
    .select("id", { count: "exact", head: true })
    .lt("created_at", cutoffIso(days, now));
  if (error) throw queryError(error, status, "counting old entries");
  const known = requireCount(count, "counting old entries");
  log(
    `Dry run: ${known} security log entries are older than ${days} days. Nothing was deleted.`,
  );
}

/** Removes the entries older than `days` through the database function. */
export async function purge(client, days, log = console.log) {
  const { data, error, status } = await client.rpc("purge_old_audit_events", {
    p_older_than: `${days} days`,
  });
  if (error) throw queryError(error, status, "removing old entries");
  const removed = requireCount(data, "removing old entries");
  log(`Removed ${removed} security log entries older than ${days} days.`);
}
