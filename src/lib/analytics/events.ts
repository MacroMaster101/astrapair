import { createHmac } from "node:crypto";

/**
 * Funnel events. Keep in step with the check constraint on
 * analytics_events in supabase/migrations/20261001100000_hardening.sql
 * (a test compares the two).
 */
export const ANALYTICS_EVENTS = [
  "registration",
  "birth_profile_completed",
  "chart_generated",
  "partner_invited",
  "partner_connected",
  "report_generated",
  "ai_question_asked",
  "account_deleted",
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/**
 * Pseudonymous reference for a user: HMAC-SHA256 of the user id keyed with the
 * secret salt, as 64 hex characters. Without the salt it cannot be tied back
 * to a person.
 */
export function userRef(userId: string, salt: string): string {
  return createHmac("sha256", salt).update(userId).digest("hex");
}

const MIN_SALT_LENGTH = 16;

/** The analytics salt, or null when it is missing or too short to be safe. */
export function getAnalyticsSalt(): string | null {
  const salt = process.env.ANALYTICS_SALT;
  return salt && salt.length >= MIN_SALT_LENGTH ? salt : null;
}
