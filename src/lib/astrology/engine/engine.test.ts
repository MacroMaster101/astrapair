import { describe, expect, it } from "vitest";
import { getAstrologyProvider } from "../provider";
import type { BirthInput } from "../types";
import { BuiltInProvider, ENGINE_NAME, ENGINE_VERSION } from "./index";

const colombo: BirthInput = {
  birthDate: "1990-07-15",
  birthTime: "12:00",
  accuracy: "exact",
  latitude: 6.93548,
  longitude: 79.84868,
  timezone: "Asia/Colombo",
};

const provider = new BuiltInProvider();

describe("BuiltInProvider (exact time)", () => {
  const chart = provider.calculateNatalChart(colombo);

  it("records engine and input metadata", () => {
    expect(chart.schemaVersion).toBe(1);
    expect(chart.engine).toEqual({
      name: ENGINE_NAME,
      version: ENGINE_VERSION,
    });
    expect(chart.zodiac).toBe("tropical");
    expect(chart.houseSystem).toBe("placidus");
    expect(chart.utc).toBe("1990-07-15T06:30:00.000Z");
    expect(chart.input).toEqual(colombo);
  });

  it("places the Sun in Cancer in the 10th house", () => {
    const sun = chart.placements.find((p) => p.body === "sun")!;
    expect(sun.sign).toBe("cancer");
    expect(sun.degree).toBeCloseTo(22.53, 1);
    expect(sun.house).toBe(10);
  });

  it("has a Libra Ascendant and Cancer Midheaven", () => {
    expect(chart.ascendant?.sign).toBe("libra");
    expect(chart.midheaven?.sign).toBe("cancer");
    expect(chart.houses).toHaveLength(12);
    expect(chart.houses?.[0].longitude).toBeCloseTo(
      chart.ascendant!.longitude,
      10,
    );
  });

  it("includes aspects to the angles", () => {
    expect(
      chart.aspects.some(
        (a) =>
          a.a === "ascendant" ||
          a.b === "ascendant" ||
          a.a === "midheaven" ||
          a.b === "midheaven",
      ),
    ).toBe(true);
  });
});

describe("BuiltInProvider (unknown time)", () => {
  const chart = provider.calculateNatalChart({
    ...colombo,
    birthTime: null,
    accuracy: "unknown",
  });

  it("never produces angles or houses", () => {
    expect(chart.ascendant).toBeNull();
    expect(chart.midheaven).toBeNull();
    expect(chart.houses).toBeNull();
    expect(chart.houseSystem).toBeNull();
    expect(chart.placements.every((p) => p.house === null)).toBe(true);
    expect(
      chart.aspects.some(
        (a) =>
          [a.a, a.b].includes("ascendant") || [a.a, a.b].includes("midheaven"),
      ),
    ).toBe(false);
  });

  it("uses local noon and reports the Moon's possible signs", () => {
    expect(chart.utc).toBe("1990-07-15T06:30:00.000Z");
    expect(chart.uncertainty.timeAccuracy).toBe("unknown");
    expect(chart.uncertainty.moonSigns?.length).toBeGreaterThanOrEqual(1);
  });
});

describe("BuiltInProvider (approximate time)", () => {
  it("reports the Ascendant signs within ±1 hour", () => {
    const chart = provider.calculateNatalChart({
      ...colombo,
      accuracy: "approximate",
    });
    expect(chart.uncertainty.ascendantSigns).toContain(chart.ascendant!.sign);
  });

  it("keeps the Ascendant sign in the candidates at Tromsø", () => {
    const chart = provider.calculateNatalChart({
      ...colombo,
      accuracy: "approximate",
      latitude: 69.6496,
      longitude: 18.956,
      timezone: "Europe/Oslo",
    });
    expect(chart.uncertainty.ascendantSigns).toContain(chart.ascendant!.sign);
  });
});

describe("BuiltInProvider (edge cases)", () => {
  it("falls back to Porphyry at high latitude", () => {
    const chart = provider.calculateNatalChart({
      ...colombo,
      latitude: 69.6496,
      longitude: 18.956,
      timezone: "Europe/Oslo",
    });
    expect(chart.houseSystem).toBe("porphyry");
    expect(chart.uncertainty.houseFallback).toBe("polar_latitude");
  });

  it("carries the DST warning", () => {
    const chart = provider.calculateNatalChart({
      ...colombo,
      birthDate: "2021-03-14",
      birthTime: "02:30",
      latitude: 40.7128,
      longitude: -74.006,
      timezone: "America/New_York",
    });
    expect(chart.uncertainty.dstWarning).toBe("nonexistent");
  });

  it("rejects a missing time unless accuracy is unknown", () => {
    expect(() =>
      provider.calculateNatalChart({ ...colombo, birthTime: null }),
    ).toThrow(/birth time/i);
  });
});

describe("getAstrologyProvider", () => {
  it("returns the built-in provider", () => {
    expect(getAstrologyProvider().name).toBe(ENGINE_NAME);
  });
});
