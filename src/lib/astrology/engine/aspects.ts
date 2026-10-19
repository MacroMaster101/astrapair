import {
  ASPECT_TYPES,
  type Aspect,
  type AspectType,
  type ChartPoint,
} from "../types";
import { angularDistance, signedDelta } from "../zodiac";

export interface PointPosition {
  point: ChartPoint;
  longitude: number;
  /** Degrees per day, or null for angles. */
  speed: number | null;
}

export const ASPECT_ANGLES: Record<AspectType, number> = {
  conjunction: 0,
  sextile: 60,
  square: 90,
  trine: 120,
  opposition: 180,
};

const BASE_ORB: Record<AspectType, number> = {
  conjunction: 8,
  opposition: 8,
  square: 7,
  trine: 7,
  sextile: 5,
};

const LUMINARY_BONUS = 2;
const isLuminary = (point: ChartPoint) => point === "sun" || point === "moon";

export function orbAllowance(
  type: AspectType,
  a: ChartPoint,
  b: ChartPoint,
): number {
  return BASE_ORB[type] + (isLuminary(a) || isLuminary(b) ? LUMINARY_BONUS : 0);
}

export function findAspects(points: PointPosition[]): Aspect[] {
  const aspects: Aspect[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i];
      const b = points[j];
      const separation = angularDistance(a.longitude, b.longitude);
      for (const type of ASPECT_TYPES) {
        const orb = Math.abs(separation - ASPECT_ANGLES[type]);
        if (orb > orbAllowance(type, a.point, b.point)) continue;

        let applying: boolean | null = null;
        if (a.speed !== null && b.speed !== null) {
          const s = signedDelta(b.longitude, a.longitude);
          const dSeparation = Math.sign(s) * (a.speed - b.speed);
          const dOrb =
            Math.sign(separation - ASPECT_ANGLES[type]) * dSeparation;
          applying = dOrb < 0;
        }
        aspects.push({ a: a.point, b: b.point, type, orb, applying });
        break;
      }
    }
  }
  return aspects.sort((x, y) => x.orb - y.orb);
}
