// Security log retention.
//   pnpm ops:purge-audit [--days N] [--dry-run]
//
// Removes audit_events rows older than N days (default 365, at least 30) by
// calling the purge_old_audit_events database function with the secret key. The
// same call also clears an account id left in a sign-up or onboarding row whose
// account no longer exists, and it prints how many old rows it removed.
//
// --dry-run only counts the rows that are older than the cutoff and deletes
// nothing. It does not count the leftover account ids the real run also clears.
//
// Uses the secret key from .env, so it runs on your machine only. Keys and
// values from the log are never printed.

import { createClient } from "@supabase/supabase-js";
import {
  OpsError,
  UsageError,
  dryRun,
  parseArgs,
  purge,
} from "./lib/purge-audit-core.mjs";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env file: the variables may already be in the environment.
}

function fail(message) {
  console.error(`ops:purge-audit: ${message}`);
  process.exitCode = 1;
}

async function main() {
  const { days, dryRun: isDryRun } = parseArgs(process.argv.slice(2));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new OpsError(
      "set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env first.",
    );
  }
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return isDryRun ? dryRun(client, days) : purge(client, days);
}

main().catch((e) => {
  if (e instanceof UsageError || e instanceof OpsError) return fail(e.message);
  // Fixed text only: the error may carry request details.
  fail(`unexpected error (${e?.name ?? "Error"}).`);
});
