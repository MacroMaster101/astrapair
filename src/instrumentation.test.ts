import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const monitoring = vi.hoisted(() => ({
  captureException: vi.fn(),
  initMonitoring: vi.fn(async () => {}),
}));
vi.mock("@/lib/monitoring", () => monitoring);

import { onRequestError, register } from "./instrumentation";

const context = {
  routerKind: "App Router" as const,
  routePath: "/(app)/chart",
  routeType: "action" as const,
  renderSource: "react-server-components" as const,
  revalidateReason: undefined,
  renderType: "dynamic" as const,
};

beforeEach(() => {
  monitoring.captureException.mockReset();
  monitoring.initMonitoring.mockClear();
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("SENTRY_DSN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("register", () => {
  it("does not initialise monitoring without a DSN", async () => {
    await register();
    expect(monitoring.initMonitoring).not.toHaveBeenCalled();
  });

  it("initialises monitoring when SENTRY_DSN is set", async () => {
    vi.stubEnv("SENTRY_DSN", "https://k@o1.ingest.sentry.io/1");
    await register();
    expect(monitoring.initMonitoring).toHaveBeenCalledTimes(1);
  });

  it("skips the edge runtime", async () => {
    vi.stubEnv("SENTRY_DSN", "https://k@o1.ingest.sentry.io/1");
    vi.stubEnv("NEXT_RUNTIME", "edge");
    await register();
    expect(monitoring.initMonitoring).not.toHaveBeenCalled();
  });
});

describe("onRequestError", () => {
  it("passes only the route path, route type and method", async () => {
    const error = new Error("boom for sam@example.com");
    await onRequestError(
      error,
      {
        path: "/chart?birth_date=1990-01-02&token=abc",
        method: "POST",
        headers: {
          cookie: "sb-access-token=secret",
          authorization: "Bearer x",
        },
      },
      context,
    );
    expect(monitoring.captureException).toHaveBeenCalledTimes(1);
    expect(monitoring.captureException).toHaveBeenCalledWith(error, {
      routePath: "/(app)/chart",
      routeType: "action",
      method: "POST",
    });
    const reported = monitoring.captureException.mock.calls[0][1];
    expect(JSON.stringify(reported)).not.toContain("1990");
    expect(JSON.stringify(reported)).not.toContain("secret");
  });

  it("adds the error digest when there is one", async () => {
    const error = Object.assign(new Error("boom"), { digest: "d1g3st" });
    await onRequestError(
      error,
      { path: "/chart", method: "GET", headers: {} },
      context,
    );
    expect(monitoring.captureException).toHaveBeenCalledWith(error, {
      routePath: "/(app)/chart",
      routeType: "action",
      method: "GET",
      digest: "d1g3st",
    });
  });

  it("never throws", async () => {
    monitoring.captureException.mockImplementationOnce(() => {
      throw new Error("reporter failed");
    });
    await expect(
      onRequestError(
        new Error("x"),
        { path: "/", method: "GET", headers: {} },
        context,
      ),
    ).resolves.toBeUndefined();
  });
});
