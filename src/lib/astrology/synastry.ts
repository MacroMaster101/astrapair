import { ENGINE_VERSION } from "./engine";
import { ASPECT_ANGLES, orbAllowance } from "./engine/aspects";
import { houseOf } from "./engine/houses";
import {
  ASPECT_TYPES,
  type AspectType,
  type Body,
  type ChartPoint,
  type NatalChart,
} from "./types";
import { angularDistance } from "./zodiac";

/** `a` is a point in person A's chart, `b` a point in person B's chart. */
export interface SynastryAspect {
  a: ChartPoint;
  b: ChartPoint;
  type: AspectType;
  orb: number;
}

export interface HouseOverlay {
  body: Body;
  house: number;
}

export interface SynastryFacts {
  schemaVersion: 1;
  engineVersion: string;
  aspects: SynastryAspect[];
  /** aInB: A's planets in B's houses; null when B has no houses (unknown time). */
  overlays: { aInB: HouseOverlay[] | null; bInA: HouseOverlay[] | null };
  /** The Moon of an unknown-time chart is left out: it moves too far in a day. */
  excluded: { aMoon: boolean; bMoon: boolean };
}

interface Point {
  point: ChartPoint;
  longitude: number;
}

const moonUnknown = (chart: NatalChart) =>
  chart.uncertainty.timeAccuracy === "unknown";

function pointsOf(chart: NatalChart): Point[] {
  const points: Point[] = chart.placements
    .filter((p) => !(moonUnknown(chart) && p.body === "moon"))
    .map((p) => ({ point: p.body, longitude: p.longitude }));
  if (chart.ascendant)
    points.push({ point: "ascendant", longitude: chart.ascendant.longitude });
  if (chart.midheaven)
    points.push({ point: "midheaven", longitude: chart.midheaven.longitude });
  return points;
}

function overlays(guest: NatalChart, host: NatalChart): HouseOverlay[] | null {
  if (!host.houses) return null;
  const cusps = host.houses.map((h) => h.longitude);
  return guest.placements
    .filter((p) => !(moonUnknown(guest) && p.body === "moon"))
    .map((p) => ({ body: p.body, house: houseOf(p.longitude, cusps) }));
}

export function calculateSynastry(a: NatalChart, b: NatalChart): SynastryFacts {
  const aspects: SynastryAspect[] = [];
  for (const x of pointsOf(a)) {
    for (const y of pointsOf(b)) {
      const separation = angularDistance(x.longitude, y.longitude);
      for (const type of ASPECT_TYPES) {
        const orb = Math.abs(separation - ASPECT_ANGLES[type]);
        if (orb <= orbAllowance(type, x.point, y.point)) {
          aspects.push({ a: x.point, b: y.point, type, orb });
          break;
        }
      }
    }
  }
  aspects.sort((m, n) => m.orb - n.orb);
  return {
    schemaVersion: 1,
    engineVersion: ENGINE_VERSION,
    aspects,
    overlays: { aInB: overlays(a, b), bInA: overlays(b, a) },
    excluded: { aMoon: moonUnknown(a), bMoon: moonUnknown(b) },
  };
}

/** Re-expresses stored facts so that side `a` is always the viewer. */
export function orientForViewer(
  facts: SynastryFacts,
  viewerIsA: boolean,
): SynastryFacts {
  if (viewerIsA) return facts;
  return {
    ...facts,
    aspects: facts.aspects.map((x) => ({ ...x, a: x.b, b: x.a })),
    overlays: { aInB: facts.overlays.bInA, bInA: facts.overlays.aInB },
    excluded: { aMoon: facts.excluded.bMoon, bMoon: facts.excluded.aMoon },
  };
}
