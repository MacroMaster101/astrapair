import { Info } from "lucide-react";
import type { NatalChart } from "@/lib/astrology/types";

export function ChartNotes({ chart }: { chart: NatalChart }) {
  const notes: string[] = [];
  if (chart.uncertainty.timeAccuracy === "unknown") {
    notes.push(
      "Without a birth time we can't calculate your Ascendant or houses, so those are left out. Planet signs are calculated for midday.",
    );
  }
  if (chart.uncertainty.timeAccuracy === "approximate") {
    notes.push(
      "Your birth time is approximate, so the Ascendant degree, house cusps, and house placements may shift.",
    );
  }
  if (chart.uncertainty.dstWarning === "nonexistent") {
    notes.push(
      "Your birth time falls in an hour skipped by a daylight saving change, so we used the first valid time after it. Check the time on your birth record.",
    );
  }
  if (chart.uncertainty.dstWarning === "ambiguous") {
    notes.push(
      "Your birth time happened twice because clocks went back that night. We used the earlier one.",
    );
  }
  if (chart.uncertainty.houseFallback === "polar_latitude") {
    notes.push(
      "Placidus houses can't be calculated this close to the poles, so your houses use the Porphyry system instead.",
    );
  }
  if (notes.length === 0) return null;
  return (
    <aside className="bg-primary/5 grid gap-2 rounded-2xl border p-4">
      {notes.map((n) => (
        <p key={n} className="flex gap-2 text-sm leading-relaxed">
          <Info aria-hidden className="text-primary mt-0.5 size-4 shrink-0" />
          {n}
        </p>
      ))}
    </aside>
  );
}
