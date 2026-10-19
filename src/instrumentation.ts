import type { Instrumentation } from "next";

export async function register() {
  // The SDK is only loaded when a DSN is configured.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.SENTRY_DSN) {
    const { initMonitoring } = await import("@/lib/monitoring");
    await initMonitoring();
  }
}

// Only the route, method and digest are reported: never the URL (its query can hold
// birth details), headers or cookies.
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  try {
    if (process.env.NEXT_RUNTIME !== "nodejs") return;
    const { captureException } = await import("@/lib/monitoring");
    // The digest is an opaque hash that links this to the browser report.
    const digest = (error as { digest?: unknown } | null)?.digest;
    captureException(error, {
      routePath: context.routePath,
      routeType: context.routeType,
      method: request.method,
      ...(typeof digest === "string" ? { digest } : {}),
    });
  } catch {
    // Reporting must never break error handling.
  }
};
