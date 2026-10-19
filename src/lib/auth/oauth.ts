import "server-only";

/**
 * Google sign-in is on unless GOOGLE_AUTH is "off" (spaces and case ignored).
 * It also needs the Google provider turned on in the Supabase dashboard; this
 * flag only hides the button.
 */
export function isGoogleAuthEnabled(
  value: string | undefined = process.env.GOOGLE_AUTH,
): boolean {
  return value?.trim().toLowerCase() !== "off";
}

export type OAuthErrorCode =
  | "oauth_unavailable"
  | "oauth_no_account"
  | "oauth_failed"
  | "oauth_rate_limited";

/**
 * Fixed copy for the codes that may appear in /login?error=. Only these codes
 * are ever put in a redirect, and anything else shows nothing, so a provider's
 * own text can never reach the page.
 */
const OAUTH_ERROR_MESSAGES: Record<OAuthErrorCode, string> = {
  oauth_unavailable:
    "Google sign-in isn't available right now. Please try again, or use your email and password.",
  oauth_no_account:
    "There's no AstraPair account for that Google email yet. Create an account with your invite code first, then you can sign in with Google.",
  oauth_failed:
    "We couldn't sign you in. Please try again, or use your email and password.",
  oauth_rate_limited:
    "Too many attempts. Please wait a few minutes and try again.",
};

export function oauthErrorMessage(
  code: string | null | undefined,
): string | null {
  if (!code || !Object.hasOwn(OAUTH_ERROR_MESSAGES, code)) return null;
  return OAUTH_ERROR_MESSAGES[code as OAuthErrorCode];
}
