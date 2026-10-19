import { describe, expect, it } from "vitest";
import {
  angularDistance,
  normalizeDegrees,
  signOf,
  signedDelta,
} from "./zodiac";

describe("normalizeDegrees", () => {
  it.each([
    [0, 0],
    [360, 0],
    [-30, 330],
    [725, 5],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeDegrees(input)).toBeCloseTo(expected, 10);
  });

  it("handles tiny negative input like -1e-15", () => {
    const result = normalizeDegrees(-1e-15);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(360);
  });

  it("normalizes -360 to exactly 0", () => {
    expect(Object.is(normalizeDegrees(-360), 0)).toBe(true);
  });
});

describe("signOf", () => {
  it("maps sign boundaries", () => {
    expect(signOf(0)).toEqual({ sign: "aries", degree: 0 });
    expect(signOf(29.999).sign).toBe("aries");
    expect(signOf(30).sign).toBe("taurus");
    expect(signOf(359.999).sign).toBe("pisces");
    expect(signOf(360).sign).toBe("aries");
  });

  it("returns the degree within the sign", () => {
    expect(signOf(112.5).sign).toBe("cancer");
    expect(signOf(112.5).degree).toBeCloseTo(22.5, 10);
  });

  it("handles tiny negative input like -1e-15", () => {
    const result = signOf(-1e-15);
    expect(result.degree).toBeLessThan(30);
  });
});

describe("angularDistance", () => {
  it("takes the short way round", () => {
    expect(angularDistance(359, 1)).toBeCloseTo(2, 10);
    expect(angularDistance(10, 200)).toBeCloseTo(170, 10);
    expect(angularDistance(0, 180)).toBeCloseTo(180, 10);
  });
});

describe("signedDelta", () => {
  it("is positive forward and negative backward, wrap-aware", () => {
    expect(signedDelta(359, 1)).toBeCloseTo(2, 10);
    expect(signedDelta(1, 359)).toBeCloseTo(-2, 10);
  });
});
