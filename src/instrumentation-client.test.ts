import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock("@sentry/nextjs", () => sentry);

beforeEach(() => {
  vi.resetModules();
  sentry.init.mockReset();
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
  vi.stubEnv("NEXT_PUBLIC_RELEASE", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("instrumentation-client", () => {
  it("does nothing without a public DSN", async () => {
    await import("./instrumentation-client");
    await new Promise((r) => setTimeout(r, 20));
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it("initialises browser Sentry with redacting, no-PII options", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://k@o1.ingest.sentry.io/1");
    vi.stubEnv("NEXT_PUBLIC_RELEASE", "rel-3");
    await import("./instrumentation-client");
    await vi.waitFor(() => expect(sentry.init).toHaveBeenCalledTimes(1));
    const options = sentry.init.mock.calls[0][0];
    expect(options).toMatchObject({
      dsn: "https://k@o1.ingest.sentry.io/1",
      release: "rel-3",
      dataCollection: { userInfo: false },
      maxBreadcrumbs: 0,
      tracePropagationTargets: [],
    });
    expect("tracesSampleRate" in options).toBe(false);
    expect(typeof options.beforeSend).toBe("function");
    expect(typeof options.beforeBreadcrumb).toBe("function");
  });

  it("swallows initialisation failures", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://k@o1.ingest.sentry.io/1");
    sentry.init.mockImplementation(() => {
      throw new Error("bad dsn");
    });
    await import("./instrumentation-client");
    await vi.waitFor(() => expect(sentry.init).toHaveBeenCalled());
  });
});
