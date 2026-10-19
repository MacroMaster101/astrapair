export const PARTNER_ERROR_CODES = [
  "not_authenticated",
  "not_onboarded",
  "no_birth_profile",
  "already_connected",
  "self_invite",
  "invite_not_found",
  "invite_expired",
  "invite_used",
  "invite_revoked",
  "not_a_member",
  "invalid_token",
  "invalid_policy",
] as const;
export type PartnerErrorCode = (typeof PARTNER_ERROR_CODES)[number];

export const GENERIC_PARTNER_ERROR = "Something went wrong. Please try again.";

const MESSAGES: Record<PartnerErrorCode, string> = {
  not_authenticated: "Sign in to continue.",
  not_onboarded: "Finish setting up your account first.",
  no_birth_profile: "Add your birth details before inviting a partner.",
  already_connected:
    "One of you is already connected with someone. Disconnect first to connect again.",
  self_invite: "This is your own invite link. Send it to your partner instead.",
  invite_not_found:
    "This invite link isn't valid. Ask your partner for a new one.",
  invite_expired:
    "This invite link has expired. Ask your partner for a new one.",
  invite_used: "This invite link has already been used.",
  invite_revoked:
    "This invite link was cancelled. Ask your partner for a new one.",
  not_a_member: "You're not part of this connection.",
  invalid_token:
    "This invite link isn't valid. Ask your partner for a new one.",
  invalid_policy: GENERIC_PARTNER_ERROR,
};

export function partnerErrorCode(
  error: { message?: string; code?: string } | null,
): PartnerErrorCode | null {
  if (!error) return null;
  if (error.code === "23505") return "already_connected";
  const message = error.message?.trim() ?? "";
  return (PARTNER_ERROR_CODES as readonly string[]).includes(message)
    ? (message as PartnerErrorCode)
    : null;
}

/**
 * Logs a database error that has no mapped code, so a production failure can be
 * diagnosed. Only a fixed message and the PostgREST code are logged: the error
 * text can embed tokens, hashes or birth data.
 */
export function logUnmappedPartnerError(
  action: string,
  error: { message?: string; code?: string } | null,
): void {
  if (error && partnerErrorCode(error) === null) {
    console.error(`${action} failed`, { code: error.code });
  }
}

export function partnerErrorMessage(
  error: { message?: string; code?: string } | null,
): string {
  const code = partnerErrorCode(error);
  return code ? MESSAGES[code] : GENERIC_PARTNER_ERROR;
}
