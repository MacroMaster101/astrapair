import { describe, expect, it } from "vitest";
import { birthProfileSchema, isoToday } from "./schema";

const valid = {
  displayName: "Ari",
  birthDate: "1990-07-15",
  accuracy: "exact",
  birthTime: "12:00",
  placeLabel: "Colombo, Western Province, Sri Lanka",
  latitude: "6.93548",
  longitude: "79.84868",
  timezone: "Asia/Colombo",
};

const errorsFor = (input: Record<string, unknown>) => {
  const r = birthProfileSchema.safeParse(input);
  expect(r.success).toBe(false);
  return r.error!.issues.map((i) => i.path[0]);
};

describe("birthProfileSchema", () => {
  it("builds a BirthInput from valid form values", () => {
    const r = birthProfileSchema.parse(valid);
    expect(r.displayName).toBe("Ari");
    expect(r.placeLabel).toBe(valid.placeLabel);
    expect(r.input).toEqual({
      birthDate: "1990-07-15",
      birthTime: "12:00",
      accuracy: "exact",
      latitude: 6.93548,
      longitude: 79.84868,
      timezone: "Asia/Colombo",
    });
  });

  it("drops the time when accuracy is unknown", () => {
    const r = birthProfileSchema.parse({
      ...valid,
      accuracy: "unknown",
      birthTime: "09:15",
    });
    expect(r.input.birthTime).toBeNull();
  });

  it("requires a time unless accuracy is unknown", () => {
    expect(errorsFor({ ...valid, birthTime: "" })).toContain("birthTime");
    expect(
      errorsFor({ ...valid, accuracy: "approximate", birthTime: "25:00" }),
    ).toContain("birthTime");
  });

  it("rejects impossible, future, and pre-1900 dates", () => {
    expect(errorsFor({ ...valid, birthDate: "1990-02-30" })).toContain(
      "birthDate",
    );
    expect(errorsFor({ ...valid, birthDate: "1899-12-31" })).toContain(
      "birthDate",
    );
    const next = new Date(Date.now() + 2 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(errorsFor({ ...valid, birthDate: next })).toContain("birthDate");
    expect(
      birthProfileSchema.safeParse({ ...valid, birthDate: isoToday() }).success,
    ).toBe(true);
  });

  it("requires a place chosen from the list", () => {
    const missing = errorsFor({
      ...valid,
      placeLabel: "",
      latitude: "",
      longitude: "",
      timezone: "",
    });
    expect(missing).toContain("placeLabel");
    expect(errorsFor({ ...valid, timezone: "Not/AZone" })).toContain(
      "timezone",
    );
    expect(errorsFor({ ...valid, latitude: "95" })).toContain("latitude");
  });

  it("trims the birth time", () => {
    expect(
      birthProfileSchema.parse({ ...valid, birthTime: " 12:00 " }).input
        .birthTime,
    ).toBe("12:00");
  });

  it("rejects non-numeric and out-of-range coordinates on their own fields", () => {
    expect(errorsFor({ ...valid, latitude: "abc" })).toContain("latitude");
    expect(errorsFor({ ...valid, longitude: "181" })).toContain("longitude");
  });

  it("rejects an unknown accuracy value", () => {
    expect(errorsFor({ ...valid, accuracy: "sometimes" })).toContain(
      "accuracy",
    );
  });
});
