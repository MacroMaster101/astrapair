/**
 * Closed-beta sign-up gate, app side. The database hook
 * (public.hook_before_user_created) is what enforces it; this module decides
 * whether the form asks for a code and how its answer is shown.
 */

import { normalizeCode } from "../../../scripts/ops/lib/beta-code-normalize.mjs";

/** Form field name, also the key the server action reads. */
export const BETA_CODE_FIELD = "betaCode";

/** The message the database hook rejects a sign-up with. */
export const BETA_CODE_HOOK_ERROR = "beta_code_invalid";

/** Keep in step with the length check in the beta gate migration. */
export const BETA_CODE_MAX_LENGTH = 64;

/** One message for an unknown code and a used up one, so codes can't be probed. */
export const BETA_CODE_INVALID_MESSAGE =
  "That invite code isn't valid or has been used up.";

/** BETA_GATE is on only when it is exactly "on" (spaces and case ignored). */
export function isBetaGateOn(
  value: string | undefined = process.env.BETA_GATE,
): boolean {
  return value?.trim().toLowerCase() === "on";
}

export type BetaCodeInput =
  { ok: true; code: string } | { ok: false; error: string };

/**
 * Checks the posted value and returns the canonical code (no spaces or hyphens,
 * upper-case), the same form the ops script hashes and the database compares.
 * The length limit applies to what was typed, as it does in the hook.
 */
export function parseBetaCode(raw: FormDataEntryValue | null): BetaCodeInput {
  const typed = typeof raw === "string" ? raw : "";
  const code = normalizeCode(typed);
  if (!code) return { ok: false, error: "Enter your invite code." };
  if (typed.length > BETA_CODE_MAX_LENGTH) {
    return { ok: false, error: BETA_CODE_INVALID_MESSAGE };
  }
  return { ok: true, code };
}

/** True when an auth error is the hook turning the sign-up down. */
export function isBetaCodeError(error: { message?: string }): boolean {
  return Boolean(error.message?.includes(BETA_CODE_HOOK_ERROR));
}
