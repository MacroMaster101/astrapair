import "server-only";
import { redactError, redactValue } from "./redact";
import {
  buildSentryOptions,
  pickAllowedTags,
  REDACTED_TEXT,
} from "./sentry-options";

export type MonitoringContext = Record<string, string | number | boolean>;

const FLUSH_TIMEOUT_MS = 2000;

export function getRelease(): string {
  return (
    process.env.NEXT_PUBLIC_RELEASE ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.npm_package_version ||
    "dev"
  );
}

function getEnvironment(): string | undefined {
  return process.env.VERCEL_ENV || process.env.NODE_ENV;
}

/** Starts the Sentry SDK. Does nothing, and loads nothing, unless SENTRY_DSN is set. */
export async function initMonitoring(): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init(
      buildSentryOptions({
        dsn,
        release: getRelease(),
        environment: getEnvironment(),
      }),
    );
  } catch {
    // Monitoring must never stop the app from starting.
  }
}

interface Payload {
  level: "error";
  release: string;
  environment: string | undefined;
  error: ReturnType<typeof redactError>;
  context: unknown;
}

// Sentry keeps its client on a global carrier, so getClient() is the same
// whichever bundle initialised it. No client means no DSN or a failed init.
function forwardToSentry(payload: Payload): void {
  if (!process.env.SENTRY_DSN) return;
  void import("@sentry/nextjs")
    .then(async (Sentry) => {
      if (!Sentry.getClient()) return;
      // Sentry gets no message text: only the error type, stack frames and
      // allowlisted tags. The original error is never handed over.
      const safe = new Error(REDACTED_TEXT);
      safe.name = payload.error.name;
      const frames = (payload.error.stack ?? "")
        .split("\n")
        .filter((line) => /^\s+at /.test(line));
      safe.stack = [`${safe.name}: ${REDACTED_TEXT}`, ...frames].join("\n");
      Sentry.captureException(safe, {
        level: payload.level,
        tags: pickAllowedTags(payload.context),
      });
      await Sentry.flush(FLUSH_TIMEOUT_MS);
    })
    .catch(() => {});
}

/**
 * Logs one redacted JSON line and, when Sentry is running, forwards the same
 * redacted data. Never throws, and never includes request bodies or headers.
 */
export function captureException(
  error: unknown,
  context?: MonitoringContext,
): void {
  try {
    const payload: Payload = {
      level: "error",
      release: getRelease(),
      environment: getEnvironment(),
      error: redactError(error),
      context: redactValue(context),
    };
    try {
      console.error(JSON.stringify(payload));
    } catch {
      // A broken console must not hide the Sentry report.
    }
    forwardToSentry(payload);
  } catch {
    // Reporting must never break the request that failed.
  }
}
