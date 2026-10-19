import { describe, expect, it } from "vitest";
import { parseStoredChart } from "./chart-schema";
import { BuiltInProvider, ENGINE_VERSION } from "./engine";
import type { BirthInput } from "./types";

const input: BirthInput = {
  birthDate: "1990-07-15",
  birthTime: "12:00",
  accuracy: "exact",
  latitude: 6.93548,
  longitude: 79.84868,
  timezone: "Asia/Colombo",
};
const provider = new BuiltInProvider();
const clone = (v: unknown) => JSON.parse(JSON.stringify(v));

describe("parseStoredChart", () => {
  it("accepts a real engine chart, including through a JSON round trip", () => {
    const chart = provider.calculateNatalChart(input);
    expect(parseStoredChart(clone(chart), ENGINE_VERSION)).toEqual(chart);
  });

  it("accepts unknown-time and polar charts", () => {
    const unknown = provider.calculateNatalChart({
      ...input,
      birthTime: null,
      accuracy: "unknown",
    });
    expect(parseStoredChart(clone(unknown), ENGINE_VERSION)).not.toBeNull();
    const polar = provider.calculateNatalChart({
      ...input,
      latitude: 69.6496,
      longitude: 18.956,
      timezone: "Europe/Oslo",
    });
    expect(parseStoredChart(clone(polar), ENGINE_VERSION)).not.toBeNull();
  });

  it("rejects a chart with no Sun placement", () => {
    const chart = clone(provider.calculateNatalChart(input));
    chart.placements = chart.placements.filter(
      (p: { body: string }) => p.body !== "sun",
    );
    expect(parseStoredChart(chart, ENGINE_VERSION)).toBeNull();
  });

  it("rejects a non-finite longitude", () => {
    const chart = clone(provider.calculateNatalChart(input));
    chart.placements[0].longitude = null; // JSON turns NaN/Infinity into null
    expect(parseStoredChart(chart, ENGINE_VERSION)).toBeNull();
    const direct = provider.calculateNatalChart(input);
    direct.placements[0].longitude = Number.NaN;
    expect(parseStoredChart(direct, ENGINE_VERSION)).toBeNull();
  });

  it("rejects a chart from a different engine version", () => {
    const chart = clone(provider.calculateNatalChart(input));
    expect(parseStoredChart(chart, "9.9.9")).toBeNull();
  });

  it("rejects non-objects and other schema versions", () => {
    expect(parseStoredChart(null, ENGINE_VERSION)).toBeNull();
    expect(parseStoredChart("chart", ENGINE_VERSION)).toBeNull();
    const chart = clone(provider.calculateNatalChart(input));
    chart.schemaVersion = 2;
    expect(parseStoredChart(chart, ENGINE_VERSION)).toBeNull();
  });
});
