import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  getClient: vi.fn(),
  captureException: vi.fn(),
  flush: vi.fn(async () => true),
}));
vi.mock("@sentry/nextjs", () => sentry);

import { captureException, getRelease, initMonitoring } from "./index";

function clearEnv() {
  vi.stubEnv("NEXT_PUBLIC_RELEASE", "");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
  vi.stubEnv("npm_package_version", "");
  vi.stubEnv("SENTRY_DSN", "");
  vi.stubEnv("VERCEL_ENV", "");
}

beforeEach(() => {
  clearEnv();
  sentry.init.mockReset();
  sentry.getClient.mockReset();
  sentry.captureException.mockReset();
  sentry.flush.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getRelease", () => {
  it("prefers NEXT_PUBLIC_RELEASE", () => {
    vi.stubEnv("NEXT_PUBLIC_RELEASE", "rel-1");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "sha");
    vi.stubEnv("npm_package_version", "1.2.3");
    expect(getRelease()).toBe("rel-1");
  });

  it("then VERCEL_GIT_COMMIT_SHA", () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "sha");
    vi.stubEnv("npm_package_version", "1.2.3");
    expect(getRelease()).toBe("sha");
  });

  it("then npm_package_version", () => {
    vi.stubEnv("npm_package_version", "1.2.3");
    expect(getRelease()).toBe("1.2.3");
  });

  it("falls back to dev", () => {
    expect(getRelease()).toBe("dev");
  });
});

describe("captureException", () => {
  it("writes one redacted JSON line to console.error", () => {
    vi.stubEnv("NEXT_PUBLIC_RELEASE", "rel-1");
    vi.stubEnv("VERCEL_ENV", "preview");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    captureException(new TypeError("Cannot read x for sam@example.com"), {
      routePath: "/chart",
      email: "sam@example.com",
      attempt: 2,
      retry: true,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0][0]);
    expect(line).not.toContain("\n");
    expect(line).not.toContain("sam@example.com");
    const payload = JSON.parse(line);
    expect(payload).toMatchObject({
      level: "error",
      release: "rel-1",
      environment: "preview",
      error: { name: "TypeError" },
      context: {
        routePath: "/chart",
        email: "[redacted]",
        attempt: 2,
        retry: true,
      },
    });
    expect(payload.error.message).toContain("Cannot read x for");
  });

  it("falls back to NODE_ENV for the environment", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    captureException(new Error("x"));
    const payload = JSON.parse(String(spy.mock.calls[0][0]));
    expect(payload.environment).toBe(process.env.NODE_ENV);
  });

  it("never throws, even when console.error throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("console is broken");
    });
    expect(() => captureException(new Error("boom"))).not.toThrow();
  });

  it("never throws on hostile inputs", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => captureException(cyclic)).not.toThrow();
    expect(() => captureException(undefined)).not.toThrow();
  });

  it("does not touch Sentry when no DSN is set", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sentry.getClient.mockReturnValue({});
    captureException(new Error("boom"));
    await new Promise((r) => setTimeout(r, 20));
    expect(sentry.getClient).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it("does not send when Sentry was never initialised", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("SENTRY_DSN", "https://k@o1.ingest.sentry.io/1");
    sentry.getClient.mockReturnValue(undefined);
    captureException(new Error("boom"));
    await vi.waitFor(() => expect(sentry.getClient).toHaveBeenCalled());
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it("forwards no message text, only the type, frames and allowed tags", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("SENTRY_DSN", "https://k@o1.ingest.sentry.io/1");
    sentry.getClient.mockReturnValue({});
    const original = new TypeError("Cannot read x for sam@example.com");
    captureException(original, {
      routePath: "/chart",
      method: "POST",
      email: "sam@example.com",
      attempt: 3,
    });
    await vi.waitFor(() => expect(sentry.captureException).toHaveBeenCalled());

    const [sent, hint] = sentry.captureException.mock.calls[0];
    expect(sent).not.toBe(original);
    expect(sent).toBeInstanceOf(Error);
    expect(sent.name).toBe("TypeError");
    expect(sent.message).toBe("[redacted]");
    expect(sent.stack.split("\n")[0]).toBe("TypeError: [redacted]");
    expect(sent.stack).toContain("    at ");
    expect(JSON.stringify([sent.message, sent.stack, hint])).not.toContain(
      "Cannot read",
    );
    expect(JSON.stringify([sent.message, sent.stack, hint])).not.toContain(
      "sam@example.com",
    );
    expect(hint).toEqual({
      level: "error",
      tags: { routePath: "/chart", method: "POST" },
    });
    expect(sentry.flush).toHaveBeenCalledWith(2000);
  });

  it("swallows Sentry failures", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("SENTRY_DSN", "https://k@o1.ingest.sentry.io/1");
    sentry.getClient.mockReturnValue({});
    sentry.captureException.mockImplementation(() => {
      throw new Error("sdk exploded");
    });
    expect(() => captureException(new Error("boom"))).not.toThrow();
    await vi.waitFor(() => expect(sentry.captureException).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("initMonitoring", () => {
  it("does nothing without a DSN", async () => {
    await initMonitoring();
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it("initialises Sentry with redacting, no-PII options when a DSN is set", async () => {
    vi.stubEnv("SENTRY_DSN", "https://k@o1.ingest.sentry.io/1");
    vi.stubEnv("NEXT_PUBLIC_RELEASE", "rel-2");
    vi.stubEnv("VERCEL_ENV", "production");
    await initMonitoring();
    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(sentry.init.mock.calls[0][0]).toMatchObject({
      dsn: "https://k@o1.ingest.sentry.io/1",
      release: "rel-2",
      environment: "production",
      dataCollection: { userInfo: false },
      maxBreadcrumbs: 0,
      tracePropagationTargets: [],
    });
    const options = sentry.init.mock.calls[0][0];
    expect("tracesSampleRate" in options).toBe(false);
    expect(typeof options.beforeSend).toBe("function");
    expect(typeof options.beforeSendTransaction).toBe("function");
  });

  it("does not throw when Sentry fails to initialise", async () => {
    vi.stubEnv("SENTRY_DSN", "https://k@o1.ingest.sentry.io/1");
    sentry.init.mockImplementation(() => {
      throw new Error("bad dsn");
    });
    await expect(initMonitoring()).resolves.toBeUndefined();
  });
});
