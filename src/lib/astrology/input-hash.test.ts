import { describe, expect, it } from "vitest";
import { inputHash } from "./input-hash";
import type { BirthInput } from "./types";

const base: BirthInput = {
  birthDate: "1990-07-15",
  birthTime: "12:00",
  accuracy: "exact",
  latitude: 6.93548,
  longitude: 79.84868,
  timezone: "Asia/Colombo",
};

describe("inputHash", () => {
  it("is stable for the same input and key order", () => {
    const reordered: BirthInput = {
      timezone: base.timezone,
      longitude: base.longitude,
      latitude: base.latitude,
      accuracy: base.accuracy,
      birthTime: base.birthTime,
      birthDate: base.birthDate,
    };
    expect(Object.keys(reordered)).not.toEqual(Object.keys(base));
    expect(inputHash(base, "1.0.0")).toBe(inputHash(reordered, "1.0.0"));
    expect(inputHash(base, "1.0.0")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any field or the engine version changes", () => {
    const h = inputHash(base, "1.0.0");
    expect(inputHash({ ...base, birthTime: "12:01" }, "1.0.0")).not.toBe(h);
    expect(inputHash({ ...base, accuracy: "approximate" }, "1.0.0")).not.toBe(
      h,
    );
    expect(inputHash({ ...base, latitude: 6.93549 }, "1.0.0")).not.toBe(h);
    expect(inputHash(base, "1.0.1")).not.toBe(h);
  });

  it("ignores floating-point noise below 1e-6 degrees", () => {
    expect(inputHash({ ...base, latitude: 6.9354800001 }, "1.0.0")).toBe(
      inputHash(base, "1.0.0"),
    );
  });
});
