import { Moon, Sparkles, Sun } from "lucide-react";
import type { NatalChart } from "@/lib/astrology/types";
import {
  ASCENDANT_MEANING,
  PLANET_MEANINGS,
} from "@/lib/astrology/interpretations";
import { bigThreeValues } from "./big-three-values";

export function BigThree({ chart }: { chart: NatalChart }) {
  const v = bigThreeValues(chart);

  const cards = [
    {
      icon: Sun,
      title: "Sun",
      value: v.sun,
      meaning: PLANET_MEANINGS.sun,
      note: null as string | null,
    },
    {
      icon: Moon,
      title: "Moon",
      value: v.moon,
      meaning: PLANET_MEANINGS.moon,
      note: v.moonNote,
    },
    {
      icon: Sparkles,
      title: "Ascendant",
      value: v.ascendant,
      meaning: ASCENDANT_MEANING,
      note: v.ascendantNote,
    },
  ];

  return (
    <section aria-labelledby="big-three" className="grid gap-4">
      <h2 id="big-three" className="text-xl font-semibold">
        Your Big Three
      </h2>
      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <div
            key={c.title}
            className="bg-card grid content-start gap-2 rounded-2xl border p-5"
          >
            <span className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-full">
              <c.icon aria-hidden className="size-4" />
            </span>
            <p className="text-muted-foreground text-sm">{c.title}</p>
            <p className="text-lg font-semibold">{c.value}</p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {c.meaning}
            </p>
            {c.note && (
              <p className="text-muted-foreground text-xs leading-relaxed">
                {c.note}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
