export const AFTER_SIGN_IN_PATH = "/dashboard";
export const SIGN_IN_PATH = "/login";

// /reset-password needs the recovery session created by the emailed link.
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/settings",
  "/onboarding",
  "/reset-password",
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

/** Only allow same-origin relative paths, to prevent open redirects. */
export function safeNextPath(
  next: string | null | undefined,
  fallback = AFTER_SIGN_IN_PATH,
) {
  if (
    !next ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.startsWith("/\\")
  ) {
    return fallback;
  }
  return next;
}
