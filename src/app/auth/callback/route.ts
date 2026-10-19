import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/routes";
import type { OAuthErrorCode } from "@/lib/auth/oauth";
import { BETA_CODE_HOOK_ERROR } from "@/lib/beta/gate";
import { createClient } from "@/lib/supabase/server";

/**
 * PKCE callback for email confirmation links and OAuth providers.
 *
 * Google sign-in marks its redirect with flow=google. Only then does a failure
 * use the oauth_* codes; any other arrival (an email link) keeps link_invalid.
 * The marker only chooses which fixed message is shown: it grants nothing. What
 * the provider or the database said is read to pick a code, never repeated.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));
  const google = searchParams.get("flow") === "google";

  if (google) {
    const providerError = searchParams.get("error");
    const providerDescription = searchParams.get("error_description");
    if (providerError !== null || providerDescription !== null) {
      // The closed-beta hook turned a Google sign-up down: no account to sign in to.
      return failure(
        origin,
        providerDescription?.includes(BETA_CODE_HOOK_ERROR)
          ? "oauth_no_account"
          : "oauth_failed",
      );
    }
  }

  if (code) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(`${origin}${next}`);
    } catch {
      // Falls through to the same answer as a refused code.
    }
    if (google) return failure(origin, "oauth_failed");
  }

  return NextResponse.redirect(`${origin}/login?error=link_invalid`);
}

function failure(origin: string, code: OAuthErrorCode) {
  return NextResponse.redirect(`${origin}/login?error=${code}`);
}
