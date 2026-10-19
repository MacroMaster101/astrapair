import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANALYTICS_EVENTS, getAnalyticsSalt, userRef } from "./events";

const SQL = readFileSync(
  join(process.cwd(), "supabase/migrations/20261001100000_hardening.sql"),
  "utf8",
);

const REPORT_SCRIPT = readFileSync(
  join(process.cwd(), "scripts/ops/lib/report-core.mjs"),
  "utf8",
);

const SALT = "a-long-enough-test-salt";
const USER_ID = "0b9b3a5e-5d3c-4c0e-9d4b-2f1f6f5a7c11";

describe("ANALYTICS_EVENTS", () => {
  it("is exactly the eight event names, in funnel order", () => {
    expect([...ANALYTICS_EVENTS]).toEqual([
      "registration",
      "birth_profile_completed",
      "chart_generated",
      "partner_invited",
      "partner_connected",
      "report_generated",
      "ai_question_asked",
      "account_deleted",
    ]);
  });

  it("matches the check constraint on analytics_events in the migration", () => {
    const table = SQL.match(
      /create table public\.analytics_events \(([\s\S]*?)\n\);/,
    );
    expect(table).not.toBeNull();
    const check = table![1].match(
      /event text not null check \(event in \(([^)]*)\)\)/,
    );
    expect(check).not.toBeNull();
    const inSql = [...check![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...inSql].sort()).toEqual([...ANALYTICS_EVENTS].sort());
  });
});

describe("ops report", () => {
  it("lists every event name", () => {
    for (const event of ANALYTICS_EVENTS) {
      expect(REPORT_SCRIPT).toContain(`"${event}"`);
    }
  });
});

describe("userRef", () => {
  it("is 64 lowercase hex characters", () => {
    expect(userRef(USER_ID, SALT)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(userRef(USER_ID, SALT)).toBe(userRef(USER_ID, SALT));
  });

  it("differs by salt", () => {
    expect(userRef(USER_ID, SALT)).not.toBe(userRef(USER_ID, `${SALT}-2`));
  });

  it("differs by user id", () => {
    expect(userRef(USER_ID, SALT)).not.toBe(
      userRef("1b9b3a5e-5d3c-4c0e-9d4b-2f1f6f5a7c11", SALT),
    );
  });

  it("never contains the user id or the salt", () => {
    const ref = userRef(USER_ID, SALT);
    expect(ref).not.toContain(USER_ID);
    expect(ref).not.toContain(USER_ID.replaceAll("-", ""));
    expect(ref).not.toContain(SALT);
  });
});

describe("getAnalyticsSalt", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a salt of at least 16 characters", () => {
    vi.stubEnv("ANALYTICS_SALT", SALT);
    expect(getAnalyticsSalt()).toBe(SALT);
  });

  it("returns null when the salt is missing, empty or too short", () => {
    vi.stubEnv("ANALYTICS_SALT", "");
    expect(getAnalyticsSalt()).toBeNull();
    vi.stubEnv("ANALYTICS_SALT", "x".repeat(15));
    expect(getAnalyticsSalt()).toBeNull();
    vi.stubEnv("ANALYTICS_SALT", undefined);
    expect(getAnalyticsSalt()).toBeNull();
  });
});
