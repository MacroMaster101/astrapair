import { buildSentryOptions } from "@/lib/monitoring/sentry-options";

// Browser monitoring is off unless a public DSN is set, and then the SDK is
// loaded lazily so it costs nothing otherwise.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  void import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.init(
        buildSentryOptions({
          dsn,
          release: process.env.NEXT_PUBLIC_RELEASE || "dev",
          environment: process.env.NODE_ENV,
        }),
      );
    })
    .catch(() => {});
}
