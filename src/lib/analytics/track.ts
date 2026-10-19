import "server-only";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAnalyticsSalt, userRef, type AnalyticsEvent } from "./events";

/** A request never waits longer than this for an analytics write. */
const TIMEOUT_MS = 2000;

let warnedAboutSalt = false;

function logFailure(event: AnalyticsEvent, code: string) {
  // Only the event name and a short code: never the user, the salt or a message.
  console.error("Analytics insert failed", { event, code });
}

async function insertEvent(event: AnalyticsEvent, ref: string) {
  const { error } = await createAdminClient()
    .from("analytics_events")
    .insert({ event, user_ref: ref });
  if (error) logFailure(event, error.code || "unknown");
}

/**
 * Records a funnel event under a pseudonymous reference. It never throws and
 * never holds a request for more than two seconds. Most callers use
 * `trackAfterResponse` so the write runs after the response is sent; account
 * deletion `await`s this directly, because it runs once the account is gone.
 * Does nothing unless ANALYTICS_SALT is set to at least 16 characters.
 */
export async function trackEvent(
  event: AnalyticsEvent,
  userId: string,
): Promise<void> {
  const salt = getAnalyticsSalt();
  if (!salt) {
    if (!warnedAboutSalt) {
      warnedAboutSalt = true;
      console.warn(
        "ANALYTICS_SALT is missing or too short; analytics is turned off.",
      );
    }
    return;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        logFailure(event, "timeout");
        resolve();
      }, TIMEOUT_MS);
    });
    await Promise.race([insertEvent(event, userRef(userId, salt)), timeout]);
  } catch {
    logFailure(event, "exception");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Records an event without holding the response: it runs after the response
 * is sent. Outside a request (tests, scripts) `after` throws, so it falls back
 * to a plain call that is not awaited. Returns at once and never throws.
 */
export function trackAfterResponse(
  event: AnalyticsEvent,
  userId: string,
): void {
  try {
    after(() => trackEvent(event, userId));
  } catch {
    trackEvent(event, userId).catch(() => {});
  }
}
