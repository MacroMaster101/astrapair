import "server-only";
import { createClient as createVerifyClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getAnalyticsSalt, userRef } from "@/lib/analytics/events";
import { trackEvent } from "@/lib/analytics/track";
import { getUserId } from "@/lib/auth/session";
import { getPublicEnv } from "@/lib/env";
import { INVITE_NEXT_COOKIE } from "@/lib/partner/next-path";
import { createRateLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type DeleteAccountResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "bad_confirmation"
        | "bad_password"
        | "verify_unavailable"
        | "reauth_required"
        | "rate_limited"
        | "not_signed_in"
        | "error";
    };

const CONFIRMATION_WORD = "DELETE";

// An account with only a Google sign-in has no password to ask for, so it must
// have signed in this recently instead.
const RECENT_SIGN_IN_SECONDS = 10 * 60;
// A sign-in time slightly ahead of this server's clock is clock skew; further
// ahead (or in milliseconds) is not a real sign-in time.
const CLOCK_SKEW_SECONDS = 60;

// Five attempts an hour per user, counted before the password is checked so
// the form cannot be used to guess a password.
const limiter = createRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 });

/** Never logs the user, the email or anything the person typed. */
function logFailure(stage: string, code: string) {
  console.error("Account deletion failed", { stage, code });
}

type PasswordCheck = "correct" | "wrong" | "unavailable";

/**
 * Checks the password with a throwaway client. It keeps no session in storage
 * and has no access to the request's cookies, so signing in with it cannot
 * write or clear the real session. A refusal of the credentials counts as a
 * wrong password. A check that could not be made (rate limit, server error,
 * network, an exception, an answer with no status that is not about the
 * credentials) is
 * reported as unavailable, so an outage does not read as a wrong password. It
 * is logged as a code only.
 */
async function checkPassword(
  email: string,
  password: string,
  userId: string,
): Promise<PasswordCheck> {
  try {
    const env = getPublicEnv();
    const verifier = createVerifyClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data, error } = await verifier.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      const status = typeof error.status === "number" ? error.status : null;
      // 0 is how the client reports a network failure.
      if (
        status !== null &&
        (status === 0 || status === 429 || status >= 500)
      ) {
        logFailure("verify", String(status));
        return "unavailable";
      }
      // No numeric status (for example a gateway answer that is not JSON):
      // only a plain credentials refusal is a wrong password.
      if (status === null && error.code !== "invalid_credentials") {
        logFailure("verify", error.code || "unknown");
        return "unavailable";
      }
      return "wrong";
    }
    if (!data?.session) return "wrong";
    // Revoke only this throwaway session so it cannot outlive the check.
    try {
      await verifier.auth.signOut({ scope: "local" });
    } catch {
      // Best effort: the account is deleted next.
    }
    // The session must belong to the signed-in user, whatever the email lookup did.
    if (data.user?.id !== userId) {
      logFailure("verify", "user_mismatch");
      return "wrong";
    }
    return "correct";
  } catch {
    logFailure("verify", "exception");
    return "unavailable";
  }
}

type UserWithProviders = {
  identities?: { provider?: string }[] | null;
  app_metadata?: { providers?: unknown } | null;
};

/**
 * True unless the user is known to have no email (password) identity. The
 * identities list is read first, then app_metadata.providers. With no provider
 * information at all the password is asked for, the stricter path.
 */
function hasPasswordIdentity(user: UserWithProviders): boolean {
  const fromIdentities = (user.identities ?? [])
    .map((identity) => identity?.provider)
    .filter((provider): provider is string => typeof provider === "string");
  const listed = user.app_metadata?.providers;
  const fromMetadata = Array.isArray(listed)
    ? listed.filter(
        (provider): provider is string => typeof provider === "string",
      )
    : [];
  const providers = fromIdentities.length > 0 ? fromIdentities : fromMetadata;
  return providers.length === 0 || providers.includes("email");
}

/**
 * Whether the signed-in user is asked for their password to delete the account
 * (true) or for a recent sign-in instead (false). Any doubt means the password.
 */
export async function accountRequiresPassword(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    return data?.user ? hasPasswordIdentity(data.user) : true;
  } catch {
    return true;
  }
}

/**
 * The newest sign-in entry of the access token's amr claim (each has a
 * timestamp in seconds) is at most ten minutes old and at most a minute ahead
 * of this clock. Token refresh entries do not count as a sign-in. A missing or
 * malformed claim, or a claim for another user, is not recent. The token is
 * verified by getClaims, so the claim can be trusted.
 */
async function signedInRecently(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getClaims();
    if (data?.claims?.sub !== userId) return false;
    const amr: unknown = data.claims.amr;
    if (!Array.isArray(amr)) return false;
    let newest = Number.NEGATIVE_INFINITY;
    for (const entry of amr) {
      const { method, timestamp } = (entry ?? {}) as {
        method?: unknown;
        timestamp?: unknown;
      };
      if (method === "token_refresh") continue;
      if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
        newest = Math.max(newest, timestamp);
      }
    }
    if (newest === Number.NEGATIVE_INFINITY) return false;
    const age = Date.now() / 1000 - newest;
    return age >= -CLOCK_SKEW_SECONDS && age <= RECENT_SIGN_IN_SECONDS;
  } catch {
    return false;
  }
}

/** Runs a step after the deletion; whatever it does, the deletion stands. */
async function bestEffort(stage: string, step: () => Promise<void> | void) {
  try {
    await step();
  } catch {
    logFailure(stage, "exception");
  }
}

/**
 * Deletes the signed-in user's account after they type DELETE and re-enter
 * their password. An account with no password (Google only) is asked for a
 * sign-in within the last ten minutes instead, and the password is ignored.
 * Deleting the auth user removes everything else: every personal table
 * cascades from it.
 */
export async function deleteOwnAccount(input: {
  confirmation: string;
  password?: string;
}): Promise<DeleteAccountResult> {
  if (input.confirmation.trim() !== CONFIRMATION_WORD) {
    return { ok: false, code: "bad_confirmation" };
  }

  const userId = await getUserId();
  if (!userId) return { ok: false, code: "not_signed_in" };

  if (!limiter.check(userId)) return { ok: false, code: "rate_limited" };

  // The email always comes from the verified session, never from the form.
  let supabase: Awaited<ReturnType<typeof createClient>>;
  let email: string | undefined;
  let usesPassword: boolean;
  try {
    supabase = await createClient();
    const { data: current } = await supabase.auth.getUser();
    if (!current?.user || current.user.id !== userId) {
      return { ok: false, code: "not_signed_in" };
    }
    email = current.user.email;
    usesPassword = hasPasswordIdentity(current.user);
  } catch {
    logFailure("session", "exception");
    return { ok: false, code: "error" };
  }
  if (usesPassword) {
    if (!email) return { ok: false, code: "bad_password" };
    const check = await checkPassword(email, input.password ?? "", userId);
    if (check === "unavailable") {
      return { ok: false, code: "verify_unavailable" };
    }
    if (check !== "correct") return { ok: false, code: "bad_password" };
  } else if (!(await signedInRecently(supabase, userId))) {
    return { ok: false, code: "reauth_required" };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      logFailure("delete", error.code || "unknown");
      return { ok: false, code: "error" };
    }
  } catch {
    logFailure("delete", "exception");
    return { ok: false, code: "error" };
  }

  // The account is gone. Nothing below can change that, so none of it may fail
  // the result.
  await bestEffort("audit", async () => {
    // The row must not identify the person: no actor, and the resource is only
    // the salted reference (or nothing when no salt is configured).
    const salt = getAnalyticsSalt();
    const { error } = await admin.from("audit_events").insert({
      actor_user_id: null,
      event_type: "account.deleted",
      resource_type: "user",
      resource_id: salt ? userRef(userId, salt) : null,
      metadata: {},
    });
    if (error) logFailure("audit", error.code || "unknown");
  });
  // Sign-up and setup log rows name the account in resource_id. The actor column
  // is cleared by the foreign key; this clears the id here too, so no log row
  // can be traced back to the person. The same reference as the row above.
  await bestEffort("audit_scrub", async () => {
    const salt = getAnalyticsSalt();
    const { error } = await admin
      .from("audit_events")
      .update({ resource_id: salt ? userRef(userId, salt) : null })
      .eq("resource_type", "user")
      .eq("resource_id", userId);
    if (error) logFailure("audit_scrub", error.code || "unknown");
  });
  await bestEffort("analytics", () => trackEvent("account_deleted", userId));
  await bestEffort("sign_out", async () => {
    await supabase.auth.signOut();
  });
  await bestEffort("cookie", async () => {
    (await cookies()).delete(INVITE_NEXT_COOKIE);
  });

  return { ok: true };
}
