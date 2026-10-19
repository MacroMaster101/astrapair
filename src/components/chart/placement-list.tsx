import type { NatalChart } from "@/lib/astrology/types";
import {
  PLANET_MEANINGS,
  RETROGRADE_NOTE,
  bodyLabel,
  describePlacement,
  formatDegree,
  ordinal,
  signLabel,
} from "@/lib/astrology/interpretations";

export function PlacementList({ chart }: { chart: NatalChart }) {
  const anyRetrograde = chart.placements.some((p) => p.retrograde);
  const timeUnknown = chart.uncertainty.timeAccuracy === "unknown";
  const moonSigns = chart.uncertainty.moonSigns;
  return (
    <section aria-labelledby="planets" className="grid gap-4">
      <h2 id="planets" className="text-xl font-semibold">
        Planets
      </h2>
      <ul className="bg-card divide-y rounded-2xl border">
        {chart.placements.map((p) => {
          // Without a birth time the Moon's position is only known to the day.
          const hideMoonDegree = timeUnknown && p.body === "moon";
          const moonRange =
            hideMoonDegree && moonSigns && moonSigns.length > 1
              ? moonSigns.map(signLabel).join(" or ")
              : null;
          return (
            <li
              key={p.body}
              className="grid gap-1 p-4 sm:grid-cols-[12rem_1fr] sm:gap-4"
            >
              <p className="font-medium">
                {bodyLabel(p.body)} in {moonRange ?? signLabel(p.sign)}
                {hideMoonDegree ? "" : ` ${formatDegree(p.degree)}`}
                {p.retrograde && (
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    (retrograde)
                  </span>
                )}
                {p.house && (
                  <span className="text-muted-foreground block text-sm font-normal">
                    {ordinal(p.house)} house
                  </span>
                )}
              </p>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {moonRange ? PLANET_MEANINGS.moon : describePlacement(p)}
              </p>
            </li>
          );
        })}
      </ul>
      {anyRetrograde && (
        <p className="text-muted-foreground text-sm">{RETROGRADE_NOTE}</p>
      )}
    </section>
  );
}
