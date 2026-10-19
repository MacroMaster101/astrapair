import { DateTime, IANAZone } from "luxon";

export type DstWarning = "nonexistent" | "ambiguous";

export function isValidTimezone(zone: string): boolean {
  return zone.length > 0 && IANAZone.isValidZone(zone);
}

/**
 * Converts a local civil date/time in an IANA zone to a UTC instant.
 * Detects wall times skipped by a DST gap ("nonexistent", shifted forward the
 * way Luxon does) and wall times that occur twice ("ambiguous", earliest wins).
 */
export function localToUtc(
  date: string,
  time: string,
  zone: string,
): { utc: Date; dstWarning?: DstWarning } {
  // Validate date format: YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date or time: ${date} ${time}`);
  }

  // Validate time format: HH:MM (00:00 to 23:59)
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error(`Invalid date or time: ${date} ${time}`);
  }

  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);

  // Validate that the date is a real calendar date
  const testDate = new Date(Date.UTC(y, m - 1, d));
  if (
    testDate.getUTCFullYear() !== y ||
    testDate.getUTCMonth() !== m - 1 ||
    testDate.getUTCDate() !== d
  ) {
    throw new Error(`Invalid date or time: ${date} ${time}`);
  }

  if (!isValidTimezone(zone)) throw new Error(`Unknown timezone: ${zone}`);

  const wallAsUtc = Date.UTC(y, m - 1, d, hh, mm);

  // Every offset the zone uses within half a day of this wall time.
  // Candidate instants lie in [wallAsUtc − 14h, wallAsUtc + 12h], so probe all whole hours from -15 to +13.
  const offsets = new Set(
    Array.from({ length: 29 }, (_, i) => i - 15).map(
      (h) => DateTime.fromMillis(wallAsUtc + h * 3_600_000, { zone }).offset,
    ),
  );

  const instants: number[] = [];
  for (const offset of offsets) {
    const instant = wallAsUtc - offset * 60_000;
    const local = DateTime.fromMillis(instant, { zone });
    if (
      local.year === y &&
      local.month === m &&
      local.day === d &&
      local.hour === hh &&
      local.minute === mm
    ) {
      instants.push(instant);
    }
  }
  instants.sort((a, b) => a - b);

  if (instants.length === 0) {
    const shifted = DateTime.fromObject(
      { year: y, month: m, day: d, hour: hh, minute: mm },
      { zone },
    );
    return { utc: shifted.toJSDate(), dstWarning: "nonexistent" };
  }
  return {
    utc: new Date(instants[0]),
    ...(instants.length > 1 ? { dstWarning: "ambiguous" as const } : {}),
  };
}
