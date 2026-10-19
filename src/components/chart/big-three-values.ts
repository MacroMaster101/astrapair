import type { NatalChart, Sign } from "@/lib/astrology/types";
import { formatDegree, signLabel } from "@/lib/astrology/interpretations";

export interface BigThreeValues {
  sun: string;
  moon: string;
  ascendant: string;
  moonNote: string | null;
  ascendantNote: string | null;
}

const signRange = (signs: Sign[]) => signs.map(signLabel).join(" or ");

function compute(chart: NatalChart, withDegrees: boolean): BigThreeValues {
  const sun = chart.placements.find((p) => p.body === "sun")!;
  const moon = chart.placements.find((p) => p.body === "moon")!;
  const moonSigns = chart.uncertainty.moonSigns;
  const ascSigns = chart.uncertainty.ascendantSigns;
  const moonRange = !!moonSigns && moonSigns.length > 1;
  const ascRange = !!ascSigns && ascSigns.length > 1;
  const timeUnknown = chart.uncertainty.timeAccuracy === "unknown";
  const deg = (d: number) => (withDegrees ? ` ${formatDegree(d)}` : "");

  return {
    sun: `${signLabel(sun.sign)}${deg(sun.degree)}`,
    // Without a birth time the Moon's degree is not meaningful.
    moon: moonRange
      ? signRange(moonSigns)
      : `${signLabel(moon.sign)}${timeUnknown ? "" : deg(moon.degree)}`,
    ascendant: chart.ascendant
      ? ascRange
        ? signRange(ascSigns)
        : `${signLabel(chart.ascendant.sign)}${deg(chart.ascendant.degree)}`
      : "Needs a birth time",
    moonNote: moonRange
      ? "The Moon changed sign on your birth day, so it depends on your birth time."
      : null,
    ascendantNote: ascRange
      ? "Your birth time is approximate, and the rising sign changes within an hour of it."
      : null,
  };
}

/** Big Three display strings, with degrees, for the chart page. */
export function bigThreeValues(chart: NatalChart): BigThreeValues {
  return compute(chart, true);
}

/** Big Three display strings, sign only or a sign range, for compact summaries. */
export function bigThreeSigns(chart: NatalChart): BigThreeValues {
  return compute(chart, false);
}
