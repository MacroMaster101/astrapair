import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AspectList } from "@/components/chart/aspect-list";
import { BigThree } from "@/components/chart/big-three";
import { ChartNotes } from "@/components/chart/chart-notes";
import { HouseList } from "@/components/chart/house-list";
import { PlacementList } from "@/components/chart/placement-list";
import { ChartWheel } from "@/components/chart/wheel/chart-wheel";
import { Button, buttonVariants } from "@/components/ui/button";
import { TIME_ACCURACY_LABELS } from "@/lib/astrology/interpretations";
import {
  getCurrentChart,
  getOwnBirthProfile,
} from "@/lib/birth-profile/service";
import { cn } from "@/lib/utils";
import { recalculateChart } from "./actions";

export const metadata: Metadata = { title: "Your chart · AstraPair" };

export default async function ChartPage() {
  const profile = await getOwnBirthProfile();
  if (!profile) redirect("/chart/birth-details");

  const result = await getCurrentChart(profile);

  return (
    <div className="grid gap-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            {profile.displayName
              ? `${profile.displayName}'s chart`
              : "Your chart"}
          </h1>
          <p className="text-muted-foreground text-sm">
            {profile.placeLabel}
            <span className="bg-primary/10 text-primary ml-2 rounded-full px-2 py-0.5 text-xs font-medium">
              {TIME_ACCURACY_LABELS[profile.input.accuracy]}
            </span>
          </p>
        </div>
        <Link
          href="/chart/birth-details"
          className={cn(buttonVariants({ variant: "outline" }), "h-10 px-4")}
        >
          Edit birth details
        </Link>
      </header>

      {result.chart ? (
        <>
          <ChartNotes chart={result.chart} />
          <BigThree chart={result.chart} />
          <ChartWheel chart={result.chart} />
          <PlacementList chart={result.chart} />
          <AspectList chart={result.chart} />
          <HouseList chart={result.chart} />
          <p className="text-muted-foreground text-xs">
            Tropical zodiac
            {result.chart.houseSystem
              ? `, ${result.chart.houseSystem === "placidus" ? "Placidus" : "Porphyry"} houses`
              : ""}
            . Astrology is offered for entertainment and self-reflection.
          </p>
        </>
      ) : (
        <div
          role="alert"
          className="bg-card grid justify-items-start gap-3 rounded-2xl border p-6"
        >
          <p className="font-medium">We couldn&apos;t calculate your chart.</p>
          <p className="text-muted-foreground text-sm">
            Your birth details are saved. Try again in a moment.
          </p>
          <form action={recalculateChart}>
            <Button type="submit" className="h-10 px-4">
              Try again
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
