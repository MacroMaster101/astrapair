import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const fake = vi.hoisted(() => ({
  after: vi.fn(),
  insert: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("next/server", () => ({ after: fake.after }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: fake.createAdminClient,
}));

import { userRef } from "./events";

const SALT = "a-long-enough-test-salt";
const USER_ID = "0b9b3a5e-5d3c-4c0e-9d4b-2f1f6f5a7c11";

let track: typeof import("./track");

beforeEach(async () => {
  // The "warned once" flag is module state, so each test gets a fresh module.
  vi.resetModules();
  fake.after.mockReset();
  fake.after.mockImplementation(() => {
    throw new Error("`after` was called outside a request scope");
  });
  fake.insert.mockReset();
  fake.insert.mockResolvedValue({ error: null });
  fake.createAdminClient.mockReset();
  fake.createAdminClient.mockReturnValue({
    from: (table: string) => ({
      insert: (row: unknown) => fake.insert(table, row),
    }),
  });
  vi.stubEnv("ANALYTICS_SALT", SALT);
  track = await import("./track");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("trackEvent", () => {
  it("inserts exactly { event, user_ref } with a valid salt", async () => {
    await track.trackEvent("registration", USER_ID);
    expect(fake.insert).toHaveBeenCalledTimes(1);
    const [table, row] = fake.insert.mock.calls[0];
    expect(table).toBe("analytics_events");
    expect(row).toEqual({
      event: "registration",
      user_ref: userRef(USER_ID, SALT),
    });
    expect(Object.keys(row).sort()).toEqual(["event", "user_ref"]);
    expect(JSON.stringify(row)).not.toContain(USER_ID);
  });

  it("does nothing when the salt is not set", async () => {
    vi.stubEnv("ANALYTICS_SALT", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await track.trackEvent("registration", USER_ID);
    expect(fake.insert).not.toHaveBeenCalled();
    expect(fake.createAdminClient).not.toHaveBeenCalled();
  });

  it("does nothing when the salt is shorter than 16 characters", async () => {
    vi.stubEnv("ANALYTICS_SALT", "0123456789abcde");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await track.trackEvent("registration", USER_ID);
    expect(fake.insert).not.toHaveBeenCalled();
  });

  it("accepts a salt of exactly 16 characters", async () => {
    vi.stubEnv("ANALYTICS_SALT", "0123456789abcdef");
    await track.trackEvent("registration", USER_ID);
    expect(fake.insert).toHaveBeenCalledTimes(1);
  });

  it("warns once per process with a fixed message and never the value", async () => {
    vi.stubEnv("ANALYTICS_SALT", "tiny-salt");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await track.trackEvent("registration", USER_ID);
    await track.trackEvent("chart_generated", USER_ID);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("tiny-salt");
  });

  it("resolves and logs only event and code when the insert returns an error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.insert.mockResolvedValue({
      error: { code: "23514", message: `bad row ${USER_ID}` },
    });
    await expect(
      track.trackEvent("registration", USER_ID),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith("Analytics insert failed", {
      event: "registration",
      code: "23514",
    });
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain(USER_ID);
    expect(logged).not.toContain(SALT);
  });

  it("resolves when the insert throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.insert.mockRejectedValue(new Error(`boom ${USER_ID}`));
    await expect(
      track.trackEvent("partner_invited", USER_ID),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith("Analytics insert failed", {
      event: "partner_invited",
      code: "exception",
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain(USER_ID);
  });

  it("resolves when the admin client cannot be created", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.createAdminClient.mockImplementation(() => {
      throw new Error("SUPABASE_SECRET_KEY is not set");
    });
    await expect(
      track.trackEvent("registration", USER_ID),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith("Analytics insert failed", {
      event: "registration",
      code: "exception",
    });
  });

  it("resolves within the 2 second cap when the insert is slow", async () => {
    vi.useFakeTimers();
    fake.insert.mockReturnValue(new Promise(() => {})); // never settles
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let done = false;
    const pending = track.trackEvent("registration", USER_ID).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(done).toBe(true);
    expect(error).toHaveBeenCalledWith("Analytics insert failed", {
      event: "registration",
      code: "timeout",
    });
  });

  it("clears its timer after a fast insert", async () => {
    vi.useFakeTimers();
    await track.trackEvent("registration", USER_ID);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("trackAfterResponse", () => {
  it("schedules the write with after() and does not run it yet", () => {
    fake.after.mockImplementation(() => {});
    expect(track.trackAfterResponse("registration", USER_ID)).toBeUndefined();
    expect(fake.after).toHaveBeenCalledTimes(1);
    expect(fake.insert).not.toHaveBeenCalled();
  });

  it("writes the event when the scheduled task runs", async () => {
    fake.after.mockImplementation(() => {});
    track.trackAfterResponse("partner_invited", USER_ID);
    await fake.after.mock.calls[0][0]();
    expect(fake.insert).toHaveBeenCalledTimes(1);
    expect(fake.insert.mock.calls[0][1]).toEqual({
      event: "partner_invited",
      user_ref: userRef(USER_ID, SALT),
    });
  });

  it("falls back to an unawaited write when there is no request scope", async () => {
    expect(track.trackAfterResponse("registration", USER_ID)).toBeUndefined();
    await vi.waitFor(() => expect(fake.insert).toHaveBeenCalledTimes(1));
    expect(fake.insert.mock.calls[0][1]).toEqual({
      event: "registration",
      user_ref: userRef(USER_ID, SALT),
    });
  });

  it("returns at once even when the write never settles", async () => {
    // Fake timers, so the 2 second cap cannot fire after the test and log into
    // whatever runs next in this worker.
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.insert.mockReturnValue(new Promise(() => {}));
    expect(() =>
      track.trackAfterResponse("registration", USER_ID),
    ).not.toThrow();
    await vi.advanceTimersByTimeAsync(2000);
    expect(error).toHaveBeenCalledWith("Analytics insert failed", {
      event: "registration",
      code: "timeout",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never throws or rejects when the write fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.insert.mockRejectedValue(new Error("boom"));
    expect(() =>
      track.trackAfterResponse("registration", USER_ID),
    ).not.toThrow();
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
  });

  it("does nothing without a salt", async () => {
    vi.stubEnv("ANALYTICS_SALT", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    track.trackAfterResponse("registration", USER_ID);
    await Promise.resolve();
    expect(fake.insert).not.toHaveBeenCalled();
  });
});
