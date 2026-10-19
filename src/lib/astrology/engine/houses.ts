import { normalizeDegrees } from "../zodiac";
import type { Angles } from "./angles";

const D = Math.PI / 180;
export const POLAR_LATITUDE_LIMIT = 66;

export type HouseSystem = "placidus" | "porphyry";

export interface HouseResult {
  system: HouseSystem;
  /** cusps[0] is the house 1 cusp ... cusps[11] is the house 12 cusp. */
  cusps: number[];
  fallback?: "polar_latitude";
}

/** Ecliptic longitude of the point with the given right ascension. */
function longitudeFromRa(ra: number, obliquity: number): number {
  return normalizeDegrees(
    Math.atan2(Math.sin(ra * D), Math.cos(ra * D) * Math.cos(obliquity * D)) /
      D,
  );
}

/**
 * Placidus intermediate cusp by fixed-point iteration on right ascension.
 * Houses 11/12 trisect the diurnal semi-arc; houses 2/3 the nocturnal one.
 */
function placidusCusp(
  kind: 11 | 12 | 2 | 3,
  { ramc, obliquity }: Angles,
  latitude: number,
): number | null {
  const fraction = kind === 11 || kind === 3 ? 1 / 3 : 2 / 3;
  let ra = ramc + { 11: 30, 12: 60, 2: 120, 3: 150 }[kind];
  for (let i = 0; i < 50; i++) {
    const lon = longitudeFromRa(ra, obliquity);
    const dec = Math.asin(Math.sin(obliquity * D) * Math.sin(lon * D));
    const x = Math.tan(latitude * D) * Math.tan(dec);
    if (Math.abs(x) >= 1) return null; // circumpolar point: Placidus undefined
    const ad = Math.asin(x) / D;
    const next =
      kind === 11 || kind === 12
        ? ramc + fraction * (90 + ad)
        : ramc + 180 - fraction * (90 - ad);
    if (Math.abs(next - ra) < 1e-7) return longitudeFromRa(next, obliquity);
    ra = next;
  }
  return null;
}

function fromIntermediates(
  asc: number,
  mc: number,
  c11: number,
  c12: number,
  c2: number,
  c3: number,
): number[] {
  const o = (x: number) => normalizeDegrees(x + 180);
  return [
    asc,
    c2,
    c3,
    o(mc),
    o(c11),
    o(c12),
    o(asc),
    o(c2),
    o(c3),
    mc,
    c11,
    c12,
  ];
}

function porphyry({ ascendant: asc, midheaven: mc }: Angles): number[] {
  const upper = normalizeDegrees(asc - mc);
  const lower = normalizeDegrees(mc + 180 - asc);
  return fromIntermediates(
    asc,
    mc,
    normalizeDegrees(mc + upper / 3),
    normalizeDegrees(mc + (2 * upper) / 3),
    normalizeDegrees(asc + lower / 3),
    normalizeDegrees(asc + (2 * lower) / 3),
  );
}

export function calculateHouses(angles: Angles, latitude: number): HouseResult {
  if (Math.abs(latitude) < POLAR_LATITUDE_LIMIT) {
    const c11 = placidusCusp(11, angles, latitude);
    const c12 = placidusCusp(12, angles, latitude);
    const c2 = placidusCusp(2, angles, latitude);
    const c3 = placidusCusp(3, angles, latitude);
    if (c11 !== null && c12 !== null && c2 !== null && c3 !== null) {
      return {
        system: "placidus",
        cusps: fromIntermediates(
          angles.ascendant,
          angles.midheaven,
          c11,
          c12,
          c2,
          c3,
        ),
      };
    }
  }
  return {
    system: "porphyry",
    cusps: porphyry(angles),
    fallback: "polar_latitude",
  };
}

/** The house (1..12) whose cusp interval contains the longitude. */
export function houseOf(longitude: number, cusps: number[]): number {
  for (let i = 0; i < 12; i++) {
    const span = normalizeDegrees(cusps[(i + 1) % 12] - cusps[i]);
    if (normalizeDegrees(longitude - cusps[i]) < span) return i + 1;
  }
  return 1;
}
