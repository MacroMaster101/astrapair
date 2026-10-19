import {
  Body as AstronomyBody,
  Ecliptic,
  GeoVector,
  MakeTime,
} from "astronomy-engine";
import { BODIES, type Body } from "../types";
import { normalizeDegrees, signedDelta } from "../zodiac";

const ASTRONOMY_BODY: Record<Body, AstronomyBody> = {
  sun: AstronomyBody.Sun,
  moon: AstronomyBody.Moon,
  mercury: AstronomyBody.Mercury,
  venus: AstronomyBody.Venus,
  mars: AstronomyBody.Mars,
  jupiter: AstronomyBody.Jupiter,
  saturn: AstronomyBody.Saturn,
  uranus: AstronomyBody.Uranus,
  neptune: AstronomyBody.Neptune,
  pluto: AstronomyBody.Pluto,
};

const HALF_DAY_MS = 43_200_000;

/** Apparent geocentric longitude on the true ecliptic of date (tropical). */
export function bodyLongitude(body: Body, utc: Date): number {
  const vector = GeoVector(ASTRONOMY_BODY[body], MakeTime(utc), true);
  return normalizeDegrees(Ecliptic(vector).elon);
}

export interface BodyPosition {
  body: Body;
  longitude: number;
  /** Degrees per day; negative when moving backward. */
  speed: number;
  retrograde: boolean;
}

export function bodyPositions(utc: Date): BodyPosition[] {
  const before = new Date(utc.getTime() - HALF_DAY_MS);
  const after = new Date(utc.getTime() + HALF_DAY_MS);
  return BODIES.map((body) => {
    const speed = signedDelta(
      bodyLongitude(body, before),
      bodyLongitude(body, after),
    );
    return {
      body,
      longitude: bodyLongitude(body, utc),
      speed,
      retrograde: body !== "sun" && body !== "moon" && speed < 0,
    };
  });
}
