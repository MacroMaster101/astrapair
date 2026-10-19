import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  getClient: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock("@sentry/nextjs", () => sentry);

import { reportBoundaryError } from "./client";

beforeEach(() => {
  sentry.getClient.mockReset();
  sentry.captureException.mockReset();
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function makeError() {
  const error = new Error("connection refused for sam@example.com");
  return Object.assign(error, { digest: "d1g3st" });
}

describe("reportBoundaryError", () => {
  it("logs only the name and digest when Sentry is not configured", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    reportBoundaryError(makeError());
    expect(spy).toHaveBeenCalledTimes(1);
    const args = spy.mock.calls[0];
    expect(JSON.stringify(args)).not.toContain("connection refused");
    expect(JSON.stringify(args)).not.toContain("sam@example.com");
    expect(args[1]).toEqual({ name: "Error", digest: "d1g3st" });
    await new Promise((r) => setTimeout(r, 20));
    expect(sentry.getClient).not.toHaveBeenCalled();
  });

  it("sends only the name and digest to Sentry when it is initialised", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://k@o1.ingest.sentry.io/1");
    sentry.getClient.mockReturnValue({});
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    reportBoundaryError(makeError());
    await vi.waitFor(() => expect(sentry.captureException).toHaveBeenCalled());
    const [sent, hint] = sentry.captureException.mock.calls[0];
    expect(sent.name).toBe("Error");
    expect(JSON.stringify([sent.message, sent.stack, hint])).not.toContain(
      "connection refused",
    );
    expect(sent.message).toBe("[redacted]");
    expect(hint).toMatchObject({ level: "error", tags: { digest: "d1g3st" } });
    expect(spy).not.toHaveBeenCalled();
  });

  it("falls back to the console when Sentry has no client", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://k@o1.ingest.sentry.io/1");
    sentry.getClient.mockReturnValue(undefined);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    reportBoundaryError(makeError());
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(spy.mock.calls[0][1]).toEqual({ name: "Error", digest: "d1g3st" });
  });

  it("never throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("console is broken");
    });
    expect(() => reportBoundaryError(makeError())).not.toThrow();
    expect(() => reportBoundaryError(null as unknown as Error)).not.toThrow();
  });

  it("redacts odd error names", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("x"), { name: "a@b.co" });
    reportBoundaryError(error);
    expect(JSON.stringify(spy.mock.calls[0])).not.toContain("a@b.co");
  });
});
