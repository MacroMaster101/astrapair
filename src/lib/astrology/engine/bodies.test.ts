import { describe, expect, it } from "vitest";
import { BODIES } from "../types";
import { angularDistance } from "../zodiac";
import { JPL_HORIZONS_LONGITUDES } from "./__fixtures__/jpl-horizons";
import { bodyLongitude, bodyPositions } from "./bodies";

describe("bodyLongitude matches JPL Horizons within 0.05°", () => {
  for (const [iso, expected] of Object.entries(JPL_HORIZONS_LONGITUDES)) {
    for (const body of BODIES) {
      it(`${body} at ${iso}`, () => {
        const actual = bodyLongitude(body, new Date(iso));
        expect(angularDistance(actual, expected[body])).toBeLessThan(0.05);
      });
    }
  }
});

describe("bodyPositions", () => {
  it("returns all ten bodies in order with speeds", () => {
    const positions = bodyPositions(new Date("2000-01-01T12:00:00Z"));
    expect(positions.map((p) => p.body)).toEqual([...BODIES]);
    const moon = positions.find((p) => p.body === "moon")!;
    expect(moon.speed).toBeGreaterThan(10);
    expect(moon.speed).toBeLessThan(16);
  });

  it("marks Mercury retrograde during its November 2012 retrograde", () => {
    const mercury = bodyPositions(new Date("2012-11-15T00:00:00Z")).find(
      (p) => p.body === "mercury",
    )!;
    expect(mercury.retrograde).toBe(true);
  });

  it("never marks the Sun or Moon retrograde", () => {
    for (const iso of Object.keys(JPL_HORIZONS_LONGITUDES)) {
      const positions = bodyPositions(new Date(iso));
      expect(positions.find((p) => p.body === "sun")!.retrograde).toBe(false);
      expect(positions.find((p) => p.body === "moon")!.retrograde).toBe(false);
    }
  });
});
