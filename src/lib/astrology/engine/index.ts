import { localToUtc } from "../time";
import type {
  AstrologyProvider,
  BirthInput,
  ChartAngle,
  NatalChart,
} from "../types";
import { ascendantSignsAround, moonSignsForLocalDay } from "../uncertainty";
import { signOf } from "../zodiac";
import { chartAngles } from "./angles";
import { findAspects, type PointPosition } from "./aspects";
import { bodyPositions } from "./bodies";
import { calculateHouses, houseOf } from "./houses";

export const ENGINE_NAME = "astrapair-builtin";
export const ENGINE_VERSION = "1.0.0";

const toAngle = (longitude: number): ChartAngle => ({
  longitude,
  ...signOf(longitude),
});

export class BuiltInProvider implements AstrologyProvider {
  readonly name = ENGINE_NAME;
  readonly version = ENGINE_VERSION;

  calculateNatalChart(input: BirthInput): NatalChart {
    const timeKnown = input.accuracy !== "unknown";
    if (timeKnown && !input.birthTime) {
      throw new Error("A birth time is required unless accuracy is unknown.");
    }

    const { utc, dstWarning } = localToUtc(
      input.birthDate,
      timeKnown ? input.birthTime! : "12:00",
      input.timezone,
    );
    const positions = bodyPositions(utc);
    const angles = timeKnown
      ? chartAngles(utc, input.latitude, input.longitude)
      : null;
    const houses = angles ? calculateHouses(angles, input.latitude) : null;

    const points: PointPosition[] = positions.map((p) => ({
      point: p.body,
      longitude: p.longitude,
      speed: p.speed,
    }));
    if (angles) {
      points.push(
        { point: "ascendant", longitude: angles.ascendant, speed: null },
        { point: "midheaven", longitude: angles.midheaven, speed: null },
      );
    }

    return {
      schemaVersion: 1,
      engine: { name: this.name, version: this.version },
      zodiac: "tropical",
      houseSystem: houses?.system ?? null,
      utc: utc.toISOString(),
      input,
      placements: positions.map((p) => ({
        body: p.body,
        longitude: p.longitude,
        ...signOf(p.longitude),
        retrograde: p.retrograde,
        house: houses ? houseOf(p.longitude, houses.cusps) : null,
      })),
      ascendant: angles ? toAngle(angles.ascendant) : null,
      midheaven: angles ? toAngle(angles.midheaven) : null,
      houses: houses
        ? houses.cusps.map((longitude, i) => ({
            house: i + 1,
            longitude,
            sign: signOf(longitude).sign,
          }))
        : null,
      aspects: findAspects(points),
      uncertainty: {
        timeAccuracy: input.accuracy,
        ...(input.accuracy === "approximate"
          ? {
              ascendantSigns: ascendantSignsAround(
                utc,
                input.latitude,
                input.longitude,
              ),
            }
          : {}),
        ...(input.accuracy === "unknown"
          ? { moonSigns: moonSignsForLocalDay(input.birthDate, input.timezone) }
          : {}),
        ...(timeKnown && dstWarning ? { dstWarning } : {}),
        ...(houses?.fallback ? { houseFallback: houses.fallback } : {}),
      },
    };
  }
}
