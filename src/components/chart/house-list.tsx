import type { NatalChart } from "@/lib/astrology/types";
import {
  HOUSE_MEANINGS,
  formatDegree,
  ordinal,
  signLabel,
} from "@/lib/astrology/interpretations";
import { signOf } from "@/lib/astrology/zodiac";

export function HouseList({ chart }: { chart: NatalChart }) {
  if (!chart.houses) return null;
  return (
    <section aria-labelledby="houses" className="grid gap-4">
      <div className="grid gap-1">
        <h2 id="houses" className="text-xl font-semibold">
          Houses
        </h2>
        <p className="text-muted-foreground text-sm">
          Twelve areas of life. The sign on each house describes how you
          approach that area.
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {chart.houses.map((h) => (
          <li
            key={h.house}
            className="bg-card grid gap-1 rounded-xl border p-4"
          >
            <p className="font-medium">
              {ordinal(h.house)} house in {signLabel(h.sign)}{" "}
              {formatDegree(signOf(h.longitude).degree)}
            </p>
            <p className="text-muted-foreground text-sm">
              {HOUSE_MEANINGS[h.house]}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
