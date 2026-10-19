import { describe, expect, it } from "vitest";
import {
  ASPECT_MEANINGS,
  HOUSE_MEANINGS,
  PLANET_MEANINGS,
  SIGN_KEYWORDS,
  describeAspect,
  describePlacement,
  formatDegree,
  pointLabel,
  signLabel,
} from "./interpretations";
import { ASPECT_TYPES, BODIES, SIGNS } from "./types";

describe("interpretations", () => {
  it("covers every body, sign, house, and aspect", () => {
    for (const b of BODIES) expect(PLANET_MEANINGS[b]).toBeTruthy();
    for (const s of SIGNS) expect(SIGN_KEYWORDS[s]).toBeTruthy();
    for (let h = 1; h <= 12; h++) expect(HOUSE_MEANINGS[h]).toBeTruthy();
    for (const a of ASPECT_TYPES) expect(ASPECT_MEANINGS[a]).toBeTruthy();
  });

  it("uses no em or en dashes", () => {
    const all = [
      ...Object.values(PLANET_MEANINGS),
      ...Object.values(SIGN_KEYWORDS),
      ...Object.values(HOUSE_MEANINGS),
      ...Object.values(ASPECT_MEANINGS),
    ].join(" ");
    expect(all).not.toMatch(/[–—]/);
  });

  it("labels points and signs", () => {
    expect(signLabel("sagittarius")).toBe("Sagittarius");
    expect(pointLabel("ascendant")).toBe("Ascendant");
    expect(pointLabel("moon")).toBe("Moon");
  });

  it("formats degrees within a sign", () => {
    expect(formatDegree(22.53)).toBe("22°");
    expect(formatDegree(0.2)).toBe("0°");
  });

  it("describes a placement and an aspect", () => {
    expect(
      describePlacement({
        body: "venus",
        longitude: 42,
        sign: "taurus",
        degree: 12,
        retrograde: false,
        house: 7,
      }),
    ).toContain("Taurus");
    expect(
      describeAspect({
        a: "sun",
        b: "moon",
        type: "trine",
        orb: 1.2,
        applying: true,
      }),
    ).toMatch(/^Sun and Moon/);
  });
});
