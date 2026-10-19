import { chartAngles } from "./engine/angles";
import { bodyLongitude } from "./engine/bodies";
import { localToUtc } from "./time";
import type { Sign } from "./types";
import { signOf } from "./zodiac";

const distinct = (signs: Sign[]) => [...new Set(signs)];

/** Distinct Ascendant signs sampled every 15 minutes across ±60 minutes. */
export function ascendantSignsAround(
  utc: Date,
  latitude: number,
  longitude: number,
): Sign[] {
  const signs: Sign[] = [];
  for (let minutes = -60; minutes <= 60; minutes += 15) {
    const t = new Date(utc.getTime() + minutes * 60_000);
    signs.push(signOf(chartAngles(t, latitude, longitude).ascendant).sign);
  }
  return distinct(signs);
}

/** Distinct Moon signs at the start and end of the local birth day. */
export function moonSignsForLocalDay(date: string, timezone: string): Sign[] {
  return distinct(
    ["00:00", "23:59"].map(
      (time) =>
        signOf(bodyLongitude("moon", localToUtc(date, time, timezone).utc))
          .sign,
    ),
  );
}
