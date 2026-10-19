import { ASPECT_TYPES, type NatalChart } from "@/lib/astrology/types";
import {
  ASPECT_LABELS,
  describeAspect,
  pointLabel,
} from "@/lib/astrology/interpretations";

export function AspectList({ chart }: { chart: NatalChart }) {
  const timeUnknown = chart.uncertainty.timeAccuracy === "unknown";
  const aspects = timeUnknown
    ? chart.aspects.filter((a) => a.a !== "moon" && a.b !== "moon")
    : chart.aspects;
  const groups = ASPECT_TYPES.map((type) => ({
    type,
    items: aspects.filter((a) => a.type === type).sort((x, y) => x.orb - y.orb),
  })).filter((g) => g.items.length > 0);
  const moonHidden = aspects.length !== chart.aspects.length;
  if (aspects.length === 0 && !moonHidden) return null;
  return (
    <section aria-labelledby="aspects" className="grid gap-4">
      <div className="grid gap-1">
        <h2 id="aspects" className="text-xl font-semibold">
          Aspects
        </h2>
        <p className="text-muted-foreground text-sm">
          Angles between planets. A smaller orb means a stronger connection.
        </p>
      </div>
      {groups.map(({ type, items }) => (
        <div key={type} className="grid gap-2">
          <h3 className="text-muted-foreground text-sm font-semibold">
            {ASPECT_LABELS[type]}
          </h3>
          <ul className="bg-card divide-y rounded-2xl border">
            {items.map((a) => (
              <li
                key={`${a.a}-${a.b}`}
                className="grid gap-1 p-4 sm:grid-cols-[12rem_1fr] sm:gap-4"
              >
                <p className="font-medium">
                  {pointLabel(a.a)} {ASPECT_LABELS[a.type].toLowerCase()}{" "}
                  {pointLabel(a.b)}
                  <span className="text-muted-foreground block text-sm font-normal">
                    Orb {a.orb.toFixed(1)}°
                  </span>
                </p>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {describeAspect(a)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {moonHidden && (
        <p className="text-muted-foreground text-sm">
          Moon aspects are hidden because the Moon moves too far in a day to
          place them without a birth time.
        </p>
      )}
    </section>
  );
}
