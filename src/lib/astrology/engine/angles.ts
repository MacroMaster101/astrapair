import { MakeTime, Rotation_EQD_ECT, SiderealTime } from "astronomy-engine";
import { normalizeDegrees } from "../zodiac";

const D = Math.PI / 180;

export interface Angles {
  /** True obliquity of the ecliptic, degrees. */
  obliquity: number;
  /** Right ascension of the Midheaven (local apparent sidereal time), degrees. */
  ramc: number;
  ascendant: number;
  midheaven: number;
}

function trueObliquity(utc: Date): number {
  const rot = Rotation_EQD_ECT(MakeTime(utc)).rot;
  return Math.atan2(rot[2][1], rot[1][1]) / D;
}

export function chartAngles(
  utc: Date,
  latitude: number,
  longitude: number,
): Angles {
  const obliquity = trueObliquity(utc);
  const ramc = normalizeDegrees(SiderealTime(MakeTime(utc)) * 15 + longitude);
  const e = obliquity * D;
  const r = ramc * D;
  const midheaven = normalizeDegrees(
    Math.atan2(Math.sin(r), Math.cos(r) * Math.cos(e)) / D,
  );
  let ascendant = normalizeDegrees(
    Math.atan2(
      Math.cos(r),
      -(Math.sin(r) * Math.cos(e) + Math.tan(latitude * D) * Math.sin(e)),
    ) / D,
  );
  // The formula above returns one of the two ecliptic points on the horizon.
  // At polar latitudes it can return the western (setting) point. The rising
  // point always lies 0-180 degrees ahead of the Midheaven, so flip when not.
  if (normalizeDegrees(ascendant - midheaven) > 180) {
    ascendant = normalizeDegrees(ascendant + 180);
  }
  return { obliquity, ramc, ascendant, midheaven };
}

/** Converts an ecliptic longitude (latitude 0) to right ascension/declination of date. */
export function eclipticToEquatorial(
  longitude: number,
  obliquity: number,
): { ra: number; dec: number } {
  const l = longitude * D;
  const e = obliquity * D;
  return {
    ra: normalizeDegrees(
      Math.atan2(Math.sin(l) * Math.cos(e), Math.cos(l)) / D,
    ),
    dec: Math.asin(Math.sin(e) * Math.sin(l)) / D,
  };
}
