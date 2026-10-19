import { describe, expect, it } from "vitest";
import { declutter, polar, wheelAngle } from "./geometry";

const TAU = 2 * Math.PI;
const mod = (value: number, by: number) => ((value % by) + by) % by;

/** Smallest distance between two angles, in the unit of `full`. */
const circularDistance = (a: number, b: number, full: number) => {
  const d = mod(a - b, full);
  return Math.min(d, full - d);
};

const expectAngle = (actual: number, expected: number) =>
  expect(circularDistance(actual, expected, TAU)).toBeCloseTo(0, 9);

describe("wheelAngle", () => {
  it("puts the Ascendant on the left", () => {
    expectAngle(wheelAngle(123, 123), Math.PI);
  });

  it("puts 90 degrees past the Ascendant at the bottom", () => {
    expectAngle(wheelAngle(213, 123), (3 * Math.PI) / 2);
  });

  it("puts 180 degrees past the Ascendant on the right", () => {
    expectAngle(wheelAngle(303, 123), 0);
  });

  it("puts 270 degrees past the Ascendant at the top", () => {
    expectAngle(wheelAngle(33, 123), Math.PI / 2);
  });
});

describe("polar", () => {
  it("maps each quadrant with the y axis pointing down", () => {
    const at = (deg: number) => polar(300, 300, 100, (deg * Math.PI) / 180);
    // Up and to the right.
    expect(at(45).x).toBeGreaterThan(300);
    expect(at(45).y).toBeLessThan(300);
    // Up and to the left.
    expect(at(135).x).toBeLessThan(300);
    expect(at(135).y).toBeLessThan(300);
    // Down and to the left.
    expect(at(225).x).toBeLessThan(300);
    expect(at(225).y).toBeGreaterThan(300);
    // Down and to the right.
    expect(at(315).x).toBeGreaterThan(300);
    expect(at(315).y).toBeGreaterThan(300);
  });

  it("lands on the axes at the cardinal angles", () => {
    const right = polar(300, 300, 100, 0);
    expect(right.x).toBeCloseTo(400, 9);
    expect(right.y).toBeCloseTo(300, 9);
    const top = polar(300, 300, 100, Math.PI / 2);
    expect(top.x).toBeCloseTo(300, 9);
    expect(top.y).toBeCloseTo(200, 9);
    const left = polar(300, 300, 100, Math.PI);
    expect(left.x).toBeCloseTo(200, 9);
    expect(left.y).toBeCloseTo(300, 9);
  });
});

describe("declutter", () => {
  const MIN = 8;

  /** Ids in ring order, starting from the first id of the input. */
  const ringOrder = (
    points: { id: string; value: number }[],
    startId: string,
  ) => {
    const start = points.find((p) => p.id === startId)!.value;
    return [...points]
      .sort((a, b) => mod(a.value - start, 360) - mod(b.value - start, 360))
      .map((p) => p.id);
  };

  const expectSeparated = (
    result: { displayLongitude: number }[],
    min: number,
  ) => {
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        expect(
          circularDistance(
            result[i].displayLongitude,
            result[j].displayLongitude,
            360,
          ),
        ).toBeGreaterThanOrEqual(min - 1e-9);
      }
    }
  };

  it("returns an empty list for no points", () => {
    expect(declutter([], MIN)).toEqual([]);
  });

  it("leaves a single planet where it is", () => {
    expect(declutter([{ id: "sun", longitude: 112.5 }], MIN)).toEqual([
      { id: "sun", longitude: 112.5, displayLongitude: 112.5 },
    ]);
  });

  it("fans out a cluster of four planets within five degrees", () => {
    const points = [
      { id: "a", longitude: 100 },
      { id: "b", longitude: 101.5 },
      { id: "c", longitude: 103 },
      { id: "d", longitude: 105 },
    ];
    const result = declutter(points, MIN);
    expectSeparated(result, MIN);
    expect(result.map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
    expect(result.map((p) => p.longitude)).toEqual([100, 101.5, 103, 105]);
    // The fan stays centred on the cluster rather than drifting away.
    const mean =
      result.reduce((sum, p) => sum + p.displayLongitude, 0) / result.length;
    expect(mean).toBeCloseTo(102.375, 6);
  });

  it("keeps the order of planets around the ring", () => {
    const points = [
      { id: "d", longitude: 105 },
      { id: "far", longitude: 250 },
      { id: "b", longitude: 101.5 },
      { id: "a", longitude: 100 },
      { id: "c", longitude: 103 },
    ];
    const result = declutter(points, MIN);
    // Output keeps the input order so callers can zip it back.
    expect(result.map((p) => p.id)).toEqual(points.map((p) => p.id));
    const before = ringOrder(
      points.map((p) => ({ id: p.id, value: p.longitude })),
      "a",
    );
    const after = ringOrder(
      result.map((p) => ({ id: p.id, value: p.displayLongitude })),
      "a",
    );
    expect(after).toEqual(before);
  });

  it("leaves distant planets untouched", () => {
    const result = declutter(
      [
        { id: "a", longitude: 10 },
        { id: "b", longitude: 11 },
        { id: "far", longitude: 200 },
        { id: "farther", longitude: 300 },
      ],
      MIN,
    );
    expect(result.find((p) => p.id === "far")!.displayLongitude).toBe(200);
    expect(result.find((p) => p.id === "farther")!.displayLongitude).toBe(300);
    expectSeparated(result, MIN);
  });

  it("handles a cluster that straddles 0 and 360 degrees", () => {
    const points = [
      { id: "a", longitude: 357 },
      { id: "b", longitude: 359 },
      { id: "c", longitude: 1 },
      { id: "d", longitude: 3 },
    ];
    const result = declutter(points, MIN);
    expectSeparated(result, MIN);
    for (const p of result) {
      expect(p.displayLongitude).toBeGreaterThanOrEqual(0);
      expect(p.displayLongitude).toBeLessThan(360);
      // Nobody is thrown to the far side of the wheel.
      expect(circularDistance(p.displayLongitude, 0, 360)).toBeLessThan(20);
    }
    expect(
      ringOrder(
        result.map((p) => ({ id: p.id, value: p.displayLongitude })),
        "a",
      ),
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps a fixed point in place and makes room around it", () => {
    const result = declutter(
      [
        { id: "a", longitude: 110 },
        { id: "axis", longitude: 111, fixed: true },
        { id: "b", longitude: 112 },
        { id: "c", longitude: 113 },
      ],
      MIN,
    );
    const shown = Object.fromEntries(
      result.map((p) => [p.id, p.displayLongitude]),
    );
    expect(shown.axis).toBeCloseTo(111, 9);
    expect(shown.a).toBeCloseTo(103, 9);
    expect(shown.b).toBeCloseTo(119, 9);
    expect(shown.c).toBeCloseTo(127, 9);
    // The fixed flag is not part of the result.
    expect(Object.keys(result[1]).sort()).toEqual([
      "displayLongitude",
      "id",
      "longitude",
    ]);
  });

  it("merges neighbouring clusters that would collide after fanning", () => {
    const result = declutter(
      [
        { id: "a", longitude: 100 },
        { id: "b", longitude: 101 },
        { id: "c", longitude: 102 },
        { id: "d", longitude: 112 },
        { id: "e", longitude: 113 },
      ],
      MIN,
    );
    expectSeparated(result, MIN);
    expect(
      ringOrder(
        result.map((p) => ({ id: p.id, value: p.displayLongitude })),
        "a",
      ),
    ).toEqual(["a", "b", "c", "d", "e"]);
  });
});
