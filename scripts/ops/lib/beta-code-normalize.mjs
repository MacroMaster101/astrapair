// How an invite code is made canonical before it is hashed or compared. No
// imports, so the sign-up form and action can use it as well as the ops script.
//
// The same rule is written in SQL in the beta gate migration
// (public.hook_before_user_created and public.check_beta_code): keep them in
// step. The alphabet is upper-case letters and digits only, so dropping spaces
// and hyphens and upper-casing never merges two different codes.

/** Trim, remove all whitespace and hyphens, upper-case. */
export function normalizeCode(raw) {
  return String(raw ?? "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
}

/** A canonical code in groups of four for reading aloud: XXXX-XXXX-XXXX. */
export function formatCode(code) {
  return code.match(/.{1,4}/g)?.join("-") ?? "";
}
