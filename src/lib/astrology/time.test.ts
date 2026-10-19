import { describe, expect, it } from "vitest";
import { isValidTimezone, localToUtc } from "./time";

describe("localToUtc", () => {
  it("converts a normal local time", () => {
    const r = localToUtc("1990-07-15", "12:00", "Asia/Colombo");
    expect(r.utc.toISOString()).toBe("1990-07-15T06:30:00.000Z");
    expect(r.dstWarning).toBeUndefined();
  });

  it("uses historical offsets (Sri Lanka was +06:30 in mid-1996)", () => {
    const r = localToUtc("1996-06-01", "12:00", "Asia/Colombo");
    expect(r.utc.toISOString()).toBe("1996-06-01T05:30:00.000Z");
  });

  it("handles midnight on a leap day", () => {
    const r = localToUtc("2000-02-29", "00:00", "Europe/London");
    expect(r.utc.toISOString()).toBe("2000-02-29T00:00:00.000Z");
  });

  it("flags a time skipped by a DST gap and shifts it forward", () => {
    const r = localToUtc("2021-03-14", "02:30", "America/New_York");
    expect(r.dstWarning).toBe("nonexistent");
    expect(r.utc.toISOString()).toBe("2021-03-14T07:30:00.000Z");
  });

  it("flags a repeated DST time and picks the earlier instant", () => {
    const r = localToUtc("2021-11-07", "01:30", "America/New_York");
    expect(r.dstWarning).toBe("ambiguous");
    expect(r.utc.toISOString()).toBe("2021-11-07T05:30:00.000Z");
  });

  it("rejects unknown timezones", () => {
    expect(() => localToUtc("2000-01-01", "12:00", "Mars/Olympus")).toThrow(
      /Unknown timezone/,
    );
  });

  it("detects ambiguous times in far-east zones like Pacific/Auckland", () => {
    const r = localToUtc("2021-04-04", "02:30", "Pacific/Auckland");
    expect(r.dstWarning).toBe("ambiguous");
    expect(r.utc.toISOString()).toBe("2021-04-03T13:30:00.000Z");
  });

  it("rejects invalid calendar date (February 30)", () => {
    expect(() => localToUtc("2021-02-30", "12:00", "Asia/Colombo")).toThrow(
      /Invalid date or time/,
    );
  });

  it("rejects invalid time (25:00)", () => {
    expect(() => localToUtc("2021-01-01", "25:00", "Asia/Colombo")).toThrow(
      /Invalid date or time/,
    );
  });
});

describe("isValidTimezone", () => {
  it("accepts IANA ids and rejects junk", () => {
    expect(isValidTimezone("Asia/Colombo")).toBe(true);
    expect(isValidTimezone("Not/AZone")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});
