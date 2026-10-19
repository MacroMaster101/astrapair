import { SIGNS, type Sign } from "./types";

/** Wrap any angle into [0, 360). */
export function normalizeDegrees(x: number): number {
  const r = ((x % 360) + 360) % 360;
  return r === 360 || Object.is(r, -0) ? 0 : r;
}

export function signOf(longitude: number): { sign: Sign; degree: number } {
  const l = normalizeDegrees(longitude);
  const index = Math.min(11, Math.floor(l / 30));
  return { sign: SIGNS[index], degree: l - index * 30 };
}

/** Smallest separation between two longitudes, 0..180. */
export function angularDistance(a: number, b: number): number {
  const d = Math.abs(normalizeDegrees(a) - normalizeDegrees(b));
  return d > 180 ? 360 - d : d;
}

/** Signed change from `from` to `to`, in (-180, 180]. */
export function signedDelta(from: number, to: number): number {
  const d = normalizeDegrees(to - from);
  return d > 180 ? d - 360 : d;
}
