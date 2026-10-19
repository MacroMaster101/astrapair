"use client";

import { redactString } from "./redact";
import { REDACTED_TEXT } from "./sentry-options";

interface BoundaryError {
  name?: unknown;
  digest?: unknown;
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? redactString(value) : fallback;
}

/**
 * Reports an error boundary hit from the browser. Only the error name and
 * digest are used: the message can hold personal data. Never throws.
 */
export function reportBoundaryError(error: BoundaryError): void {
  try {
    const name = text(error?.name, "Error");
    const digest = text(error?.digest, "none");
    const fields = { name, digest };

    const log = () => {
      try {
        console.error("[app-error]", fields);
      } catch {
        // Nothing left to try.
      }
    };

    if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
      log();
      return;
    }
    void import("@sentry/nextjs")
      .then((Sentry) => {
        if (!Sentry.getClient()) return log();
        const safe = new Error(REDACTED_TEXT);
        safe.name = name;
        safe.stack = `${name}: ${REDACTED_TEXT}`;
        Sentry.captureException(safe, { level: "error", tags: { digest } });
      })
      .catch(log);
  } catch {
    // Reporting must never break the error screen.
  }
}
