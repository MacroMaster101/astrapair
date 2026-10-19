import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DAYS,
  MAX_DAYS,
  MIN_DAYS,
  OpsError,
  UsageError,
  cutoffIso,
  dryRun,
  parseArgs,
  purge,
} from "../../../scripts/ops/lib/purge-audit-core.mjs";

describe("parseArgs", () => {
  it("defaults to 365 days and a real run", () => {
    expect(DEFAULT_DAYS).toBe(365);
    expect(parseArgs([])).toEqual({ days: 365, dryRun: false });
  });

  it("reads --days in both forms and --dry-run in any order", () => {
    expect(parseArgs(["--days", "90"])).toEqual({ days: 90, dryRun: false });
    expect(parseArgs(["--days=90"])).toEqual({ days: 90, dryRun: false });
    expect(parseArgs(["--dry-run", "--days", "120"])).toEqual({
      days: 120,
      dryRun: true,
    });
    expect(parseArgs(["--days=31", "--dry-run"])).toEqual({
      days: 31,
      dryRun: true,
    });
  });

  it("enforces the 30 day minimum, as the database function does", () => {
    expect(MIN_DAYS).toBe(30);
    expect(parseArgs(["--days", "30"]).days).toBe(30);
    for (const days of ["29", "0", "1"]) {
      expect(() => parseArgs(["--days", days])).toThrow(UsageError);
      expect(() => parseArgs([`--days=${days}`])).toThrow(/from 30/);
    }
  });

  it("enforces a maximum so a typo does not mean never", () => {
    expect(parseArgs(["--days", String(MAX_DAYS)]).days).toBe(MAX_DAYS);
    expect(() => parseArgs(["--days", String(MAX_DAYS + 1)])).toThrow(
      UsageError,
    );
  });

  it.each([["abc"], ["-5"], ["1.5"], ["1e3"], [" 60"], [""]])(
    "rejects a --days value of %j",
    (value) => {
      expect(() => parseArgs(["--days", value])).toThrow(UsageError);
    },
  );

  it("rejects --days with no value", () => {
    expect(() => parseArgs(["--days"])).toThrow(UsageError);
  });

  it("rejects unknown arguments instead of ignoring them", () => {
    expect(() => parseArgs(["--force"])).toThrow(UsageError);
    expect(() => parseArgs(["365"])).toThrow(UsageError);
    expect(() => parseArgs(["--dry-run=false"])).toThrow(UsageError);
  });
});

describe("cutoffIso", () => {
  it("is exactly that many days before now", () => {
    const now = new Date("2026-10-12T12:00:00.000Z");
    expect(cutoffIso(365, now)).toBe("2025-10-12T12:00:00.000Z");
    expect(cutoffIso(30, now)).toBe("2026-09-12T12:00:00.000Z");
  });
});

type Answer = {
  count?: number | null;
  data?: unknown;
  error?: unknown;
  status?: number;
};

/** A stand-in for the Supabase client: records calls, touches no network. */
function fakeClient(answer: Answer) {
  const rpc = vi.fn(async () => answer);
  const lt = vi.fn(async () => answer);
  const select = vi.fn(() => ({ lt }));
  const from = vi.fn(() => ({ select }));
  return { client: { from, rpc }, from, select, lt, rpc };
}

describe("dryRun", () => {
  const now = new Date("2026-10-12T12:00:00.000Z");

  it("counts the old rows and never calls the purge function", async () => {
    const fake = fakeClient({ count: 7, error: null });
    const log = vi.fn();
    await dryRun(fake.client, 90, log, now);
    expect(fake.from).toHaveBeenCalledWith("audit_events");
    expect(fake.select).toHaveBeenCalledWith("id", {
      count: "exact",
      head: true,
    });
    expect(fake.lt).toHaveBeenCalledWith("created_at", cutoffIso(90, now));
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "Dry run: 7 security log entries are older than 90 days. Nothing was deleted.",
    );
  });

  it("prints a real zero as zero", async () => {
    const log = vi.fn();
    await dryRun(fakeClient({ count: 0, error: null }).client, 90, log, now);
    expect(log.mock.calls[0][0]).toContain("Dry run: 0 security log entries");
  });

  it("treats a missing count as an error, not as zero", async () => {
    const log = vi.fn();
    await expect(
      dryRun(fakeClient({ count: null, error: null }).client, 90, log, now),
    ).rejects.toThrow(OpsError);
    expect(log).not.toHaveBeenCalled();
  });

  it("names the migration when the table or function is missing", async () => {
    const fake = fakeClient({ error: { code: "PGRST205" }, status: 404 });
    await expect(dryRun(fake.client, 90, vi.fn(), now)).rejects.toThrow(
      /20261001100000_hardening\.sql/,
    );
  });
});

describe("purge", () => {
  it("calls the database function with the interval and reports the count", async () => {
    const fake = fakeClient({ data: 12, error: null });
    const log = vi.fn();
    await purge(fake.client, 400, log);
    expect(fake.rpc).toHaveBeenCalledWith("purge_old_audit_events", {
      p_older_than: "400 days",
    });
    expect(fake.from).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "Removed 12 security log entries older than 400 days.",
    );
  });

  it("treats a missing count as an error, not as zero removed", async () => {
    const log = vi.fn();
    await expect(
      purge(fakeClient({ data: null, error: null }).client, 400, log),
    ).rejects.toThrow(OpsError);
    expect(log).not.toHaveBeenCalled();
  });

  it("shows the migration hint for a missing function", async () => {
    await expect(
      purge(fakeClient({ error: { code: "PGRST202" } }).client, 400, vi.fn()),
    ).rejects.toThrow(/hardening migration/);
  });

  it("prints only the error code, never the error's own text", async () => {
    const secret = "postgres://user:hunter2@host/db";
    const fake = fakeClient({
      error: { code: "XX000", message: secret, details: secret },
    });
    const error = await purge(fake.client, 400, vi.fn()).catch((e) => e);
    expect(error).toBeInstanceOf(OpsError);
    expect(error.message).toContain("XX000");
    expect(error.message).not.toContain("hunter2");
  });

  it("says the host is unreachable for status 0", async () => {
    await expect(
      purge(
        fakeClient({ error: { code: "" }, status: 0 }).client,
        400,
        vi.fn(),
      ),
    ).rejects.toThrow(/could not reach Supabase/);
  });
});
