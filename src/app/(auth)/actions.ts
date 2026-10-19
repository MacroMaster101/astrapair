"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { trackAfterResponse } from "@/lib/analytics/track";
import { isGoogleAuthEnabled } from "@/lib/auth/oauth";
import {
  SIGN_IN_PATH,
  onboardingTarget,
  safeNextPath,
} from "@/lib/auth/routes";
import {
  forgotPasswordSchema,
  formValues,
  signInSchema,
  signUpSchema,
  toFieldErrors,
  type FormState,
} from "@/lib/auth/validation";
import {
  BETA_CODE_FIELD,
  BETA_CODE_INVALID_MESSAGE,
  isBetaCodeError,
  isBetaGateOn,
  parseBetaCode,
} from "@/lib/beta/gate";
import {
  INVITE_NEXT_COOKIE,
  inviteNextCookieOptions,
  parseInvitePath,
} from "@/lib/partner/next-path";
import { createRateLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const AUTH_UNAVAILABLE_MESSAGE =
  "Sign in isn't available right now. Please try again in a few minutes.";

function isNetworkFailure(error: { name?: string; message?: string }) {
  return (
    error.name === "AuthRetryableFetchError" ||
    /fetch failed|failed to fetch|network/i.test(error.message ?? "")
  );
}

const RATE_LIMITED: FormState = {
  error: "Too many attempts. Please wait a few minutes and try again.",
};

// Ten sign-up or Google sign-in attempts per client address in ten minutes.
// Sign-up counts before the invite code is checked, so the form cannot be used
// to guess codes. Per server instance, like the other limiters.
// The key comes from a header a client may choose, so the number of keys held
// and the length of each are capped.
const authLimiter = createRateLimiter({
  limit: 10,
  windowMs: 10 * 60 * 1000,
  maxKeys: 10_000,
});
const MAX_KEY_LENGTH = 64;

type RequestHeaders = Awaited<ReturnType<typeof headers>>;

/**
 * The first X-Forwarded-For entry, else X-Real-IP, else one shared bucket.
 * Relies on the hosting platform overwriting X-Forwarded-For; on a host that
 * passes the client's header through, this key can be spoofed.
 */
function clientKey(requestHeaders: RequestHeaders): string {
  const forwarded = requestHeaders
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const key = forwarded || requestHeaders.get("x-real-ip")?.trim() || "unknown";
  return key.slice(0, MAX_KEY_LENGTH);
}

export async function signUp(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const betaGate = isBetaGateOn();
  const result = await createAccount(formData, betaGate);
  return {
    ...result,
    values: formValues(
      formData,
      betaGate
        ? ["displayName", "email", BETA_CODE_FIELD]
        : ["displayName", "email"],
    ),
  };
}

const INVALID_BETA_CODE: FormState = {
  fieldErrors: { [BETA_CODE_FIELD]: [BETA_CODE_INVALID_MESSAGE] },
};

/**
 * Read-only check of an invite code, fail closed. Runs before the auth server
 * is called so the answer never depends on whether the email is registered; the
 * "Before user created" hook still enforces the gate and uses the code up.
 * A failed check is logged with a fixed message and an error code only, so a
 * missing SUPABASE_SECRET_KEY or an unapplied migration shows up in the logs.
 */
async function betaCodeIsUsable(code: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc("check_beta_code", {
      p_code: code,
    });
    if (error) {
      console.error("beta_code_check_failed", error.code || "unknown");
      return false;
    }
    return data === true;
  } catch {
    console.error("beta_code_check_failed", "exception");
    return false;
  }
}

/**
 * The code travels as user metadata, which GoTrue saves and copies into tokens.
 * Remove it once the sign-up is through. Best effort: never fails the sign-up,
 * and logs a fixed message with an error code only.
 */
async function clearBetaCode(userId: string): Promise<void> {
  try {
    const { error } = await createAdminClient().auth.admin.updateUserById(
      userId,
      { user_metadata: { beta_code: null } },
    );
    if (error) {
      console.error("beta_code_cleanup_failed", error.code ?? error.status);
    }
  } catch {
    console.error("beta_code_cleanup_failed", "exception");
  }
}

/**
 * Runs the clean-up after the response is sent, so it adds no wait to sign-up.
 * Outside a request (tests, scripts) `after` throws, so it falls back to a plain
 * call that is not awaited. Never throws: clearBetaCode handles its own errors.
 */
function clearBetaCodeAfterResponse(userId: string): void {
  try {
    after(() => clearBetaCode(userId));
  } catch {
    clearBetaCode(userId).catch(() => {});
  }
}

async function createAccount(
  formData: FormData,
  betaGate: boolean,
): Promise<FormState> {
  const parsed = signUpSchema.safeParse({
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  // With the gate off the field is not on the form: ignore anything posted.
  const beta = betaGate
    ? parseBetaCode(formData.get(BETA_CODE_FIELD))
    : undefined;
  if (!parsed.success || beta?.ok === false) {
    return {
      fieldErrors: {
        ...(parsed.success ? {} : toFieldErrors(parsed.error).fieldErrors),
        ...(beta?.ok === false ? { [BETA_CODE_FIELD]: [beta.error] } : {}),
      },
    };
  }

  const requestHeaders = await headers();
  if (!authLimiter.check(clientKey(requestHeaders))) return RATE_LIMITED;

  if (beta?.ok && !(await betaCodeIsUsable(beta.code))) {
    return INVALID_BETA_CODE;
  }

  const next = safeNextPath(formData.get("next")?.toString(), "");
  const target = onboardingTarget(next);

  // Server Actions reject cross-origin requests, so Origin is trustworthy here.
  const origin = requestHeaders.get("origin");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        display_name: parsed.data.displayName,
        // Checked by the "Before user created" hook. Never logged.
        ...(beta?.ok ? { beta_code: beta.code } : {}),
      },
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(target)}`,
    },
  });

  if (error) {
    if (betaGate && isBetaCodeError(error)) {
      return INVALID_BETA_CODE;
    }
    if (error.code === "weak_password") {
      return { fieldErrors: { password: ["Choose a stronger password."] } };
    }
    if (error.code === "over_email_send_rate_limit" || error.status === 429) {
      return RATE_LIMITED;
    }
    // Existing emails are not revealed: with email confirmation on, Supabase
    // returns success for them too.
    return { error: "We couldn't create your account. Please try again." };
  }

  // The confirmation email always lands on /onboarding, so remember an invite
  // the person came from until they finish onboarding.
  const invite = parseInvitePath(next);
  const cookieStore = await cookies();
  if (invite) {
    cookieStore.set(INVITE_NEXT_COOKIE, invite, inviteNextCookieOptions());
  } else {
    // Clear any invite left by someone else who used this browser.
    cookieStore.delete(INVITE_NEXT_COOKIE);
  }

  // Before the redirects below, which throw. With email confirmation on,
  // Supabase answers an existing address with a disguised user that has no
  // identities: that is not a new registration.
  if (data.user && data.user.identities?.length !== 0) {
    trackAfterResponse("registration", data.user.id);
    if (beta?.ok) clearBetaCodeAfterResponse(data.user.id);
  }

  // With email confirmation disabled, Supabase signs the user in immediately.
  if (data.session) redirect(target);

  // No address in the URL: it would land in hosting request logs.
  redirect("/check-email");
}

export async function signIn(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const result = await authenticate(formData);
  return { ...result, values: formValues(formData, ["email"]) };
}

async function authenticate(formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return toFieldErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    if (error.code === "email_not_confirmed") {
      return {
        error:
          "Please confirm your email address first. Check your inbox for the link.",
      };
    }
    if (error.status === 429) return RATE_LIMITED;
    // Status 0 is a request that never got an answer; 5xx is the auth service
    // failing. Neither says anything about the password. A network failure can
    // also arrive with no status at all, so name it by type or message.
    if (
      error.status === 0 ||
      (error.status ?? 0) >= 500 ||
      (error.status === undefined && isNetworkFailure(error))
    ) {
      return { error: AUTH_UNAVAILABLE_MESSAGE };
    }
    return { error: "Incorrect email or password." };
  }

  redirect(safeNextPath(formData.get("next")?.toString()));
}

export async function requestPasswordReset(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["email"]);
  const parsed = forgotPasswordSchema.safeParse(values);
  if (!parsed.success) return { ...toFieldErrors(parsed.error), values };

  const origin = (await headers()).get("origin");
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(
    parsed.data.email,
    { redirectTo: `${origin}/auth/callback?next=/reset-password` },
  );

  if (error?.status === 429) return { ...RATE_LIMITED, values };
  if (error) {
    return { error: "We couldn't send the email. Please try again.", values };
  }

  // Same response whether or not the account exists, so emails can't be probed.
  return { message: parsed.data.email, values };
}

/**
 * Where this request came from: its Origin, else its Host. Null if neither.
 * Server actions from a browser always carry Origin, so the Host branch is a
 * fallback only; either way Supabase checks redirectTo against its allow list.
 */
function requestOrigin(requestHeaders: RequestHeaders): string | null {
  const origin = requestHeaders.get("origin");
  if (origin) return origin;
  const host = requestHeaders.get("host");
  if (!host) return null;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const protocol =
    requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (local ? "http" : "https");
  return `${protocol}://${host}`;
}

/**
 * Sends the person to Google. The request (cookie) client makes the call so the
 * PKCE verifier cookie is set; /auth/callback finishes the sign-in. The
 * returned URL holds a state value, so it is never logged. Every failure goes
 * back to /login with a code from the fixed list.
 */
export async function signInWithGoogle(formData: FormData): Promise<void> {
  const unavailable = `${SIGN_IN_PATH}?error=oauth_unavailable`;
  if (!isGoogleAuthEnabled()) redirect(unavailable);

  const requestHeaders = await headers();
  if (!authLimiter.check(clientKey(requestHeaders))) {
    redirect(`${SIGN_IN_PATH}?error=oauth_rate_limited`);
  }

  const origin = requestOrigin(requestHeaders);
  if (!origin) redirect(unavailable);

  const next = safeNextPath(formData.get("next")?.toString());
  // flow=google only picks the error copy in the callback; nothing trusts it.
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}&flow=google`;

  let url: string | null = null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (!error) url = data?.url ?? null;
  } catch {
    url = null;
  }

  // Outside the try: redirect() works by throwing.
  redirect(url ?? unavailable);
}
