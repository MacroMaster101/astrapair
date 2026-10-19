import { describe, expect, it } from "vitest";
import { findAspects, orbAllowance, type PointPosition } from "./aspects";

const p = (
  point: PointPosition["point"],
  longitude: number,
  speed: number | null = 0,
): PointPosition => ({
  point,
  longitude,
  speed,
});

describe("orbAllowance", () => {
  it("uses the base orbs plus 2° for the Sun or Moon", () => {
    expect(orbAllowance("conjunction", "mars", "venus")).toBe(8);
    expect(orbAllowance("square", "mars", "venus")).toBe(7);
    expect(orbAllowance("sextile", "mars", "venus")).toBe(5);
    expect(orbAllowance("sextile", "sun", "mars")).toBe(7);
  });
});

describe("findAspects", () => {
  it("finds a conjunction across 0°", () => {
    const [aspect] = findAspects([p("mars", 0.5), p("venus", 359.5)]);
    expect(aspect).toMatchObject({
      a: "mars",
      b: "venus",
      type: "conjunction",
    });
    expect(aspect.orb).toBeCloseTo(1, 10);
  });

  it("finds a square and reports the orb", () => {
    const [aspect] = findAspects([p("mars", 10), p("saturn", 100.5)]);
    expect(aspect.type).toBe("square");
    expect(aspect.orb).toBeCloseTo(0.5, 10);
  });

  it("ignores separations outside the allowed orb", () => {
    expect(findAspects([p("mars", 0), p("venus", 65.5)])).toEqual([]);
    expect(findAspects([p("sun", 0), p("mars", 69)])).toEqual([]);
  });

  it("gives the luminaries a wider orb", () => {
    const [aspect] = findAspects([p("sun", 0), p("mars", 66)]);
    expect(aspect.type).toBe("sextile");
  });

  it("marks applying and separating aspects", () => {
    const separating = findAspects([p("mercury", 0, 1), p("mars", 88, 0)])[0];
    expect(separating.applying).toBe(false);
    const applying = findAspects([p("mercury", 0, -1), p("mars", 88, 0)])[0];
    expect(applying.applying).toBe(true);
  });

  it("returns applying null when an angle is involved", () => {
    const [aspect] = findAspects([
      p("venus", 100, 1),
      p("ascendant", 100.5, null),
    ]);
    expect(aspect.applying).toBeNull();
  });

  it("sorts tighter aspects first", () => {
    const aspects = findAspects([
      p("mars", 0),
      p("venus", 3),
      p("saturn", 120.2),
    ]);
    expect(aspects.map((a) => a.orb)).toEqual(
      [...aspects.map((a) => a.orb)].sort((x, y) => x - y),
    );
  });

  it("detects applying conjunction when Moon approaches from below (359.9°)", () => {
    const [aspect] = findAspects([p("moon", 359.9, 13.2), p("saturn", 0, 0)]);
    expect(aspect.type).toBe("conjunction");
    expect(aspect.applying).toBe(true);
  });

  it("detects separating conjunction when Moon moves away (0.1°)", () => {
    const [aspect] = findAspects([p("moon", 0.1, 13.2), p("saturn", 0, 0)]);
    expect(aspect.type).toBe("conjunction");
    expect(aspect.applying).toBe(false);
  });

  it("detects applying opposition when Moon approaches from below (179.9°)", () => {
    const [aspect] = findAspects([p("moon", 179.9, 13.2), p("saturn", 0, 0)]);
    expect(aspect.type).toBe("opposition");
    expect(aspect.applying).toBe(true);
  });

  it("detects separating opposition when Moon moves away (180.1°)", () => {
    const [aspect] = findAspects([p("moon", 180.1, 13.2), p("saturn", 0, 0)]);
    expect(aspect.type).toBe("opposition");
    expect(aspect.applying).toBe(false);
  });

  it("returns false when both points have equal speeds", () => {
    const [aspect] = findAspects([p("mars", 0, 0.5), p("venus", 88, 0.5)]);
    expect(aspect.applying).toBe(false);
  });
});
