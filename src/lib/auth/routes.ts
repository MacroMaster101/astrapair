export const AFTER_SIGN_IN_PATH = "/dashboard";
export const SIGN_IN_PATH = "/login";

// /reset-password needs the recovery session created by the emailed link.
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/settings",
  "/onboarding",
  "/reset-password",
  "/chart",
  "/partner",
  "/ask",
];
const GUEST_ONLY_PREFIXES = ["/login", "/signup", "/forgot-password"];

function matches(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export type RouteAccess = "protected" | "guest-only" | "public";

export function getRouteAccess(pathname: string): RouteAccess {
  if (PROTECTED_PREFIXES.some((p) => matches(pathname, p))) return "protected";
  if (GUEST_ONLY_PREFIXES.some((p) => matches(pathname, p)))
    return "guest-only";
  return "public";
}

// Control characters, whitespace and backslashes are stripped or rewritten by
// URL parsers ("/<TAB>/evil.com" becomes "//evil.com"), so reject them outright.
const UNSAFE_NEXT_CHARS = /[\x00-\x20\x7f\\]/;
const PARSE_BASE = "http://n";

/** Only allow same-origin relative paths, to prevent open redirects. */
export function safeNextPath(
  next: string | null | undefined,
  fallback = AFTER_SIGN_IN_PATH,
) {
  if (
    !next ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    UNSAFE_NEXT_CHARS.test(next)
  ) {
    return fallback;
  }
  let url: URL;
  try {
    url = new URL(next, PARSE_BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== PARSE_BASE) return fallback;
  const normalised = url.pathname + url.search + url.hash;
  // Dot segments can collapse "/.//evil.com" into a protocol-relative "//evil.com".
  if (!normalised.startsWith("/") || normalised.startsWith("//")) {
    return fallback;
  }
  // Resolving the result again must stay on the same origin.
  try {
    if (new URL(normalised, PARSE_BASE).origin !== PARSE_BASE) return fallback;
  } catch {
    return fallback;
  }
  return normalised;
}

/** Where sign up sends a new user, carrying a validated `next` through onboarding. */
export function onboardingTarget(next: string | null | undefined) {
  const safe = safeNextPath(next, "");
  return safe ? `/onboarding?next=${encodeURIComponent(safe)}` : "/onboarding";
}
