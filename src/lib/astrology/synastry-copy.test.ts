import { describe, expect, it } from "vitest";
import {
  CHALLENGING_TYPES,
  SUPPORTIVE_TYPES,
  describeOverlay,
  describeSynastryAspect,
  synastryAspectTitle,
} from "./synastry-copy";
import { ASPECT_TYPES } from "./types";

describe("synastry copy", () => {
  it("puts every aspect type in exactly one group", () => {
    const all = [...SUPPORTIVE_TYPES, ...CHALLENGING_TYPES].sort();
    expect(all).toEqual([...ASPECT_TYPES].sort());
  });

  it("titles an aspect from the viewer's side", () => {
    expect(
      synastryAspectTitle({ a: "venus", b: "mars", type: "trine", orb: 1 }),
    ).toBe("Your Venus trine their Mars");
  });

  it("describes an aspect in plain words", () => {
    expect(
      describeSynastryAspect({ a: "sun", b: "moon", type: "square", orb: 2 }),
    ).toMatch(/tension/);
  });

  it("describes overlays in both directions", () => {
    expect(describeOverlay({ body: "sun", house: 7 }, "theirsInYours")).toBe(
      "Their Sun falls in your 7th house, the area of partnerships and close relationships.",
    );
    expect(describeOverlay({ body: "venus", house: 5 }, "yoursInTheirs")).toBe(
      "Your Venus falls in their 5th house, the area of romance, creativity, and play.",
    );
  });

  it("uses no em or en dashes", () => {
    const text = [
      synastryAspectTitle({
        a: "sun",
        b: "ascendant",
        type: "opposition",
        orb: 3,
      }),
      describeSynastryAspect({
        a: "mars",
        b: "pluto",
        type: "conjunction",
        orb: 3,
      }),
      describeOverlay({ body: "mars", house: 12 }, "yoursInTheirs"),
    ].join(" ");
    expect(text).not.toMatch(/[–—]/);
  });
});
