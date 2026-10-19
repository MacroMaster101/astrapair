import { describe, expect, it } from "vitest";
import { BuiltInProvider, ENGINE_VERSION } from "./engine";
import { calculateSynastry, orientForViewer } from "./synastry";
import type { BirthInput } from "./types";

const provider = new BuiltInProvider();
const colombo: BirthInput = {
  birthDate: "1990-07-15",
  birthTime: "12:00",
  accuracy: "exact",
  latitude: 6.93548,
  longitude: 79.84868,
  timezone: "Asia/Colombo",
};
const london: BirthInput = {
  birthDate: "1988-02-03",
  birthTime: "08:45",
  accuracy: "exact",
  latitude: 51.5074,
  longitude: -0.1278,
  timezone: "Europe/London",
};
const a = provider.calculateNatalChart(colombo);
const b = provider.calculateNatalChart(london);
const bUnknown = provider.calculateNatalChart({
  ...london,
  birthTime: null,
  accuracy: "unknown",
});

describe("calculateSynastry", () => {
  it("finds every body conjunct itself when a chart meets itself", () => {
    const facts = calculateSynastry(a, a);
    for (const body of ["sun", "moon", "venus", "mars"] as const) {
      const self = facts.aspects.find((x) => x.a === body && x.b === body);
      expect(self?.type).toBe("conjunction");
      expect(self?.orb).toBeCloseTo(0, 10);
    }
  });

  it("records version and sorts aspects by orb", () => {
    const facts = calculateSynastry(a, b);
    expect(facts.schemaVersion).toBe(1);
    expect(facts.engineVersion).toBe(ENGINE_VERSION);
    const orbs = facts.aspects.map((x) => x.orb);
    expect(orbs).toEqual([...orbs].sort((x, y) => x - y));
    expect(facts.aspects.length).toBeGreaterThan(0);
  });

  it("includes angles only for charts that have them, and overlays both ways", () => {
    const facts = calculateSynastry(a, b);
    expect(
      facts.aspects.some((x) => x.a === "ascendant" || x.b === "ascendant"),
    ).toBe(true);
    expect(facts.overlays.aInB).toHaveLength(10);
    expect(facts.overlays.bInA).toHaveLength(10);
    expect(facts.excluded).toEqual({ aMoon: false, bMoon: false });
  });

  it("excludes the Moon, angles and houses of an unknown-time chart", () => {
    const facts = calculateSynastry(a, bUnknown);
    expect(facts.excluded).toEqual({ aMoon: false, bMoon: true });
    expect(
      facts.aspects.some(
        (x) => x.b === "moon" || x.b === "ascendant" || x.b === "midheaven",
      ),
    ).toBe(false);
    expect(facts.overlays.aInB).toBeNull();
    expect(facts.overlays.bInA).toHaveLength(9);
    expect(facts.overlays.bInA!.some((o) => o.body === "moon")).toBe(false);
  });
});

describe("orientForViewer", () => {
  it("returns facts unchanged for viewer A", () => {
    const facts = calculateSynastry(a, bUnknown);
    expect(orientForViewer(facts, true)).toEqual(facts);
  });

  it("swaps sides for viewer B", () => {
    const facts = calculateSynastry(a, bUnknown);
    const swapped = orientForViewer(facts, false);
    expect(swapped.excluded).toEqual({ aMoon: true, bMoon: false });
    expect(swapped.overlays.aInB).toEqual(facts.overlays.bInA);
    expect(swapped.overlays.bInA).toEqual(facts.overlays.aInB);
    expect(swapped.aspects[0]).toEqual({
      ...facts.aspects[0],
      a: facts.aspects[0].b,
      b: facts.aspects[0].a,
    });
  });
});
