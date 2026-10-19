import { safeNextPath } from "@/lib/auth/routes";
import { isWellFormedToken } from "./token";

/**
 * The confirmation email always lands on /onboarding, so an invite the person
 * arrived with is remembered in this cookie until onboarding finishes.
 */
export const INVITE_NEXT_COOKIE = "astrapair_next";

const INVITE_PREFIX = "/invite/";

export function invitePath(token: string): string {
  return `${INVITE_PREFIX}${token}`;
}

/** Returns the path only when it is exactly `/invite/<well-formed token>`. */
export function parseInvitePath(
  value: string | null | undefined,
): string | null {
  if (!value?.startsWith(INVITE_PREFIX)) return null;
  return isWellFormedToken(value.slice(INVITE_PREFIX.length)) ? value : null;
}

export function inviteNextCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  };
}

/** The explicit `next` wins; otherwise fall back to a remembered invite path. */
export function resolveOnboardingNext(
  next: string | null | undefined,
  cookieValue: string | null | undefined,
): string | null {
  return safeNextPath(next, "") || parseInvitePath(cookieValue);
}
