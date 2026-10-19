// Closed-beta invite codes.
//   pnpm ops:beta-code create <label> [--uses N]
//   pnpm ops:beta-code list
//   pnpm ops:beta-code disable <label>
//
// Uses the secret key from .env, so it runs on your machine only. Only the
// sha256 hash of a code is stored; `create` prints the code once and it cannot
// be shown again. Keys are never printed.
//
// Keep multi-use codes (--uses N) short-lived and disable them once the cohort
// has joined: the app clears the code from each new user's metadata after
// sign-up, but that is best effort, so a live code can linger there if it fails.

import { createClient } from "@supabase/supabase-js";
import {
  UsageError,
  formatCode,
  generateCode,
  hashCode,
  parseCommand,
} from "./lib/beta-code-core.mjs";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env file: the variables may already be in the environment.
}

class OpsError extends Error {}

function fail(message) {
  console.error(`ops:beta-code: ${message}`);
  process.exitCode = 1;
}

/** Turns a failed query into a fixed-text error: details may carry request data. */
function queryError(error, status, doing) {
  if (status === 0) {
    return new OpsError(
      `could not reach Supabase while ${doing}. Check your network and NEXT_PUBLIC_SUPABASE_URL.`,
    );
  }
  const hint =
    error.code === "PGRST205" || error.code === "42P01"
      ? " Has the beta gate migration been applied?"
      : "";
  return new OpsError(
    `could not complete ${doing} (code ${error.code || "unknown"}).${hint}`,
  );
}

async function create(client, { label, uses }) {
  const existing = await client
    .from("beta_invite_codes")
    .select("code_hash")
    .eq("label", label)
    .limit(1);
  if (existing.error) {
    throw queryError(existing.error, existing.status, "checking the label");
  }
  if (existing.data.length > 0) {
    throw new OpsError(
      `a code labelled "${label}" already exists (labels are never reused, even for a disabled code). Pick another label.`,
    );
  }

  const code = generateCode();
  const { error, status } = await client
    .from("beta_invite_codes")
    .insert({ code_hash: hashCode(code), label, max_uses: uses });
  if (error) throw queryError(error, status, "creating the code");

  console.log(`Created "${label}" (${uses} ${uses === 1 ? "use" : "uses"}).`);
  console.log(`Invite code: ${formatCode(code)}`);
  console.log(
    "Dashes, spaces and case are ignored when it is typed. This is the only time the code is shown. Copy it now.",
  );
  if (uses > 1) {
    console.log(
      "Multi-use codes should be short-lived: disable this one once the cohort has joined.",
    );
  }
}

async function list(client) {
  const { data, error, status } = await client
    .from("beta_invite_codes")
    .select("label, uses, max_uses, disabled_at, created_at")
    .order("created_at");
  if (error) throw queryError(error, status, "reading the codes");
  if (data.length === 0) {
    console.log("No invite codes yet.");
    return;
  }
  const rows = data.map((r) => ({
    label: r.label,
    used: `${r.uses}/${r.max_uses}`,
    disabled: r.disabled_at ? "yes" : "no",
  }));
  const widths = {
    label: Math.max(5, ...rows.map((r) => r.label.length)),
    used: Math.max(4, ...rows.map((r) => r.used.length)),
  };
  console.log(
    `${"label".padEnd(widths.label)}  ${"used".padEnd(widths.used)}  disabled`,
  );
  for (const r of rows) {
    console.log(
      `${r.label.padEnd(widths.label)}  ${r.used.padEnd(widths.used)}  ${r.disabled}`,
    );
  }
}

async function disable(client, { label }) {
  const active = await client
    .from("beta_invite_codes")
    .select("code_hash, uses, max_uses, created_at")
    .eq("label", label)
    .is("disabled_at", null);
  if (active.error) {
    throw queryError(active.error, active.status, "finding the code");
  }
  if (active.data.length === 0) {
    throw new OpsError(`no active code is labelled "${label}".`);
  }
  if (active.data.length > 1) {
    const matches = active.data
      .map(
        (r) =>
          `  created ${r.created_at.slice(0, 10)}, used ${r.uses}/${r.max_uses}`,
      )
      .join("\n");
    throw new OpsError(
      `${active.data.length} active codes are labelled "${label}", so nothing was disabled. Disable them one at a time in the Supabase table editor:\n${matches}`,
    );
  }

  const { error, status } = await client
    .from("beta_invite_codes")
    .update({ disabled_at: new Date().toISOString() })
    .eq("code_hash", active.data[0].code_hash)
    .is("disabled_at", null);
  if (error) throw queryError(error, status, "disabling the code");
  console.log(`Disabled "${label}".`);
}

async function main() {
  const parsed = parseCommand(process.argv.slice(2));

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

  if (parsed.command === "create") return create(client, parsed);
  if (parsed.command === "list") return list(client);
  return disable(client, parsed);
}

main().catch((e) => {
  if (e instanceof UsageError || e instanceof OpsError) return fail(e.message);
  // Fixed text only: the error may carry request details.
  fail(`unexpected error (${e?.name ?? "Error"}).`);
});
