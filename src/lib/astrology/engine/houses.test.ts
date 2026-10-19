import { Horizon, MakeTime, Observer } from "astronomy-engine";
import { describe, expect, it } from "vitest";
import { normalizeDegrees } from "../zodiac";
import { chartAngles, eclipticToEquatorial } from "./angles";
import { calculateHouses, houseOf } from "./houses";

const D = Math.PI / 180;
const CASES = [
  { iso: "1990-07-15T06:30:00Z", lat: 6.93548, lon: 79.84868 }, // Colombo
  { iso: "1975-03-21T18:45:00Z", lat: 51.5074, lon: -0.1278 }, // London
  { iso: "2012-12-21T11:11:00Z", lat: -33.8688, lon: 151.2093 }, // Sydney
  { iso: "1955-11-05T23:59:00Z", lat: 40.7128, lon: -74.006 }, // New York
];

/** Hour angle in (-180, 180]. */
function hourAngle(ramc: number, ra: number) {
  const h = normalizeDegrees(ramc - ra);
  return h > 180 ? h - 360 : h;
}

describe("chartAngles", () => {
  it.each(CASES)("Ascendant rises on the eastern horizon ($iso)", (c) => {
    const utc = new Date(c.iso);
    const a = chartAngles(utc, c.lat, c.lon);
    const eq = eclipticToEquatorial(a.ascendant, a.obliquity);
    const h = Horizon(
      MakeTime(utc),
      new Observer(c.lat, c.lon, 0),
      eq.ra / 15,
      eq.dec,
    );
    expect(Math.abs(h.altitude)).toBeLessThan(0.01);
    expect(h.azimuth).toBeGreaterThan(0);
    expect(h.azimuth).toBeLessThan(180);
  });

  it.each(CASES)("Midheaven sits on the upper meridian ($iso)", (c) => {
    const a = chartAngles(new Date(c.iso), c.lat, c.lon);
    const eq = eclipticToEquatorial(a.midheaven, a.obliquity);
    expect(Math.abs(hourAngle(a.ramc, eq.ra))).toBeLessThan(1e-6);
  });
});

describe("Ascendant at extreme latitudes", () => {
  const instants = [
    "2000-06-21T12:00:00Z",
    "2001-01-01T00:00:00Z",
    "2010-03-20T06:00:00Z",
    "2015-09-23T18:00:00Z",
  ];
  const longitudes = [-180, -90, 0, 90];
  const latitudes = [
    66.5, 69.65, 75, 85, -66.5, -69.65, -75, -85, -33.87, 51.5,
  ];
  const cases: Array<[string, number, number]> = [];
  for (const iso of instants) {
    for (const lon of longitudes) {
      for (const lat of latitudes) cases.push([iso, lon, lat]);
    }
  }

  it.each(cases)(
    "is the rising point, ahead of the Midheaven (time=%s, lon=%d, lat=%d)",
    (iso, lon, lat) => {
      const utc = new Date(iso);
      const a = chartAngles(utc, lat, lon);
      const eq = eclipticToEquatorial(a.ascendant, a.obliquity);
      const h = Horizon(
        MakeTime(utc),
        new Observer(lat, lon, 0),
        eq.ra / 15,
        eq.dec,
      );
      expect(Math.abs(h.altitude)).toBeLessThan(0.01);
      expect(h.azimuth).toBeGreaterThan(0);
      expect(h.azimuth).toBeLessThan(180);
      const ahead = normalizeDegrees(a.ascendant - a.midheaven);
      expect(ahead).toBeGreaterThan(0);
      expect(ahead).toBeLessThanOrEqual(180);
    },
  );
});

describe("Placidus houses", () => {
  it.each(CASES)("cusps trisect the semi-arcs ($iso)", (c) => {
    const a = chartAngles(new Date(c.iso), c.lat, c.lon);
    const { system, cusps } = calculateHouses(a, c.lat);
    expect(system).toBe("placidus");
    const dsa = (lon: number) => {
      const { dec } = eclipticToEquatorial(lon, a.obliquity);
      return 90 + Math.asin(Math.tan(c.lat * D) * Math.tan(dec * D)) / D;
    };
    const ha = (lon: number) =>
      hourAngle(a.ramc, eclipticToEquatorial(lon, a.obliquity).ra);
    // House 11 cusp: 1/3 of the diurnal semi-arc east of the meridian.
    expect(ha(cusps[10]) + dsa(cusps[10]) / 3).toBeCloseTo(0, 5);
    // House 12 cusp: 2/3 of the diurnal semi-arc.
    expect(ha(cusps[11]) + (2 * dsa(cusps[11])) / 3).toBeCloseTo(0, 5);
    // House 2 cusp: 1/3 of the nocturnal semi-arc below the horizon.
    expect(
      ha(cusps[1]) + dsa(cusps[1]) + (180 - dsa(cusps[1])) / 3,
    ).toBeCloseTo(0, 5);
    // House 3 cusp: 2/3 of the nocturnal semi-arc.
    expect(
      ha(cusps[2]) + dsa(cusps[2]) + (2 * (180 - dsa(cusps[2]))) / 3,
    ).toBeCloseTo(0, 5);
  });

  it.each(CASES)("cusps go around the zodiac once ($iso)", (c) => {
    const a = chartAngles(new Date(c.iso), c.lat, c.lon);
    const { cusps } = calculateHouses(a, c.lat);
    expect(cusps).toHaveLength(12);
    expect(cusps[0]).toBeCloseTo(a.ascendant, 10);
    expect(cusps[9]).toBeCloseTo(a.midheaven, 10);
    let total = 0;
    for (let i = 0; i < 12; i++) {
      const span = normalizeDegrees(cusps[(i + 1) % 12] - cusps[i]);
      expect(span).toBeGreaterThan(0);
      expect(span).toBeLessThan(180);
      total += span;
    }
    expect(total).toBeCloseTo(360, 8);
  });
});

describe("polar fallback", () => {
  it("uses Porphyry above the polar circle (Tromsø)", () => {
    const a = chartAngles(new Date("2000-06-21T12:00:00Z"), 69.6496, 18.956);
    const result = calculateHouses(a, 69.6496);
    expect(result.system).toBe("porphyry");
    expect(result.fallback).toBe("polar_latitude");
    expect(result.cusps.every(Number.isFinite)).toBe(true);
  });

  const polarCases: Array<[string, number, number]> = [];
  const times = [
    "2000-06-21T12:00:00Z",
    "2001-01-01T00:00:00Z",
    "2010-03-20T06:00:00Z",
    "2015-09-23T18:00:00Z",
  ];
  const lons = [-180, -90, 0, 90];
  const lats = [69.65, 80, -80, 89.9];

  for (const time of times) {
    for (const lon of lons) {
      for (const lat of lats) {
        polarCases.push([time, lon, lat]);
      }
    }
  }

  it.each(polarCases)(
    "produces monotonic cusps at all polar coords (time=%s, lon=%d, lat=%d)",
    (iso: string, lon: number, lat: number) => {
      const a = chartAngles(new Date(iso), lat, lon);
      const result = calculateHouses(a, lat);
      expect(result.system).toBe("porphyry");
      expect(result.fallback).toBe("polar_latitude");
      expect(result.cusps.every(Number.isFinite)).toBe(true);

      // Cusps[0] is the true Ascendant
      expect(result.cusps[0]).toBeCloseTo(a.ascendant, 10);

      // Every span is monotonic and < 180°
      let total = 0;
      for (let i = 0; i < 12; i++) {
        const span = normalizeDegrees(
          result.cusps[(i + 1) % 12] - result.cusps[i],
        );
        expect(span).toBeGreaterThan(0);
        expect(span).toBeLessThan(180);
        total += span;
      }

      // Spans sum to 360°
      expect(total).toBeCloseTo(360, 8);
    },
  );
});

describe("houseOf", () => {
  const cusps = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
  it("puts a point exactly on a cusp in that house", () => {
    expect(houseOf(30, cusps)).toBe(2);
  });
  it("wraps across 0°", () => {
    expect(houseOf(359.9, cusps)).toBe(12);
    const shifted = cusps.map((c) => normalizeDegrees(c + 350));
    expect(houseOf(5, shifted)).toBe(1);
  });
});
