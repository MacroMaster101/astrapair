import Link from "next/link";
import {
  CHALLENGING_TYPES,
  SUPPORTIVE_TYPES,
  describeOverlay,
  describeSynastryAspect,
  synastryAspectTitle,
} from "@/lib/astrology/synastry-copy";
import type { HouseOverlay, SynastryAspect } from "@/lib/astrology/synastry";
import type { AspectType } from "@/lib/astrology/types";
import type { PartnerState, PartnerSummary } from "@/lib/partner/service";
import { ReportCard } from "@/components/report/report-card";
import { buttonVariants } from "@/components/ui/button";
import type { ReportState } from "@/lib/report/service";
import { cn } from "@/lib/utils";
import { DisconnectPanel } from "./disconnect-panel";
import { formatDate } from "./format-date";

type Connected = Extract<PartnerState, { kind: "connected" }>;

const TOP_COUNT = 8;
const BIRTH_DETAILS_PATH = "/chart/birth-details";

function AspectItem({ aspect }: { aspect: SynastryAspect }) {
  return (
    <li className="grid gap-1 p-4 sm:grid-cols-[14rem_1fr] sm:gap-4">
      <p className="font-medium">
        {synastryAspectTitle(aspect)}
        <span className="text-muted-foreground block text-sm font-normal">
          Orb {aspect.orb.toFixed(1)}°
        </span>
      </p>
      <p className="text-muted-foreground text-sm leading-relaxed">
        {describeSynastryAspect(aspect)}
      </p>
    </li>
  );
}

function AspectGroup({
  id,
  title,
  intro,
  types,
  aspects,
}: {
  id: string;
  title: string;
  intro: string;
  types: AspectType[];
  aspects: SynastryAspect[];
}) {
  const items = aspects
    .filter((x) => types.includes(x.type))
    .sort((m, n) => m.orb - n.orb);
  const top = items.slice(0, TOP_COUNT);
  const rest = items.slice(TOP_COUNT);
  const key = (x: SynastryAspect) => `${x.a}-${x.b}-${x.type}`;

  return (
    <section aria-labelledby={id} className="grid gap-3">
      <div className="grid gap-1">
        <h2 id={id} className="text-xl font-semibold">
          {title}
        </h2>
        <p className="text-muted-foreground text-sm">{intro}</p>
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No connections of this kind between your charts.
        </p>
      ) : (
        <>
          <ul className="bg-card divide-y rounded-2xl border">
            {top.map((x) => (
              <AspectItem key={key(x)} aspect={x} />
            ))}
          </ul>
          {rest.length > 0 && (
            <details className="group">
              <summary className="text-primary focus-visible:ring-ring/50 w-fit cursor-pointer rounded-md text-sm font-medium outline-none focus-visible:ring-3">
                Show all ({items.length})
              </summary>
              <ul className="bg-card mt-3 divide-y rounded-2xl border">
                {rest.map((x) => (
                  <AspectItem key={key(x)} aspect={x} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function OverlaySection({
  id,
  title,
  overlays,
  direction,
}: {
  id: string;
  title: string;
  overlays: HouseOverlay[];
  direction: "yoursInTheirs" | "theirsInYours";
}) {
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <h2 id={id} className="text-xl font-semibold">
        {title}
      </h2>
      <ul className="bg-card divide-y rounded-2xl border">
        {overlays.map((o) => (
          <li
            key={o.body}
            className="text-muted-foreground p-4 text-sm leading-relaxed"
          >
            {describeOverlay(o, direction)}
          </li>
        ))}
      </ul>
    </section>
  );
}

function BigThreeColumn({
  id,
  heading,
  summary,
}: {
  id: string;
  heading: string;
  summary: PartnerSummary;
}) {
  const rows = summary.bigThree
    ? [
        ["Sun", summary.bigThree.sun],
        ["Moon", summary.bigThree.moon],
        ["Ascendant", summary.bigThree.ascendant],
      ]
    : null;
  return (
    <section
      aria-labelledby={id}
      className="bg-card grid content-start gap-3 rounded-2xl border p-5"
    >
      <h3 id={id} className="font-semibold">
        {heading}
      </h3>
      {rows ? (
        <dl className="grid gap-2">
          {rows.map(([label, value]) => (
            <div key={label} className="bg-muted rounded-xl p-3">
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-muted-foreground text-sm">Not available yet.</p>
      )}
    </section>
  );
}

function Waiting({
  youMissing,
  partnerMissing,
  partnerName,
}: {
  youMissing: boolean;
  partnerMissing: boolean;
  partnerName: string | null;
}) {
  return (
    <div className="bg-card grid justify-items-start gap-3 rounded-2xl border p-6">
      <p className="font-medium">
        Your compatibility facts appear once you both have a chart.
      </p>
      {youMissing && (
        <>
          <p className="text-muted-foreground text-sm">
            Add your birth details to see how your charts connect.
          </p>
          <Link
            href={BIRTH_DETAILS_PATH}
            className={cn(buttonVariants(), "h-10 px-4")}
          >
            Add your birth details
          </Link>
        </>
      )}
      {partnerMissing && (
        <p className="text-muted-foreground text-sm">
          Waiting for {partnerName ?? "your partner"} to add their birth
          details.
        </p>
      )}
    </div>
  );
}

export function ConnectedView({
  state,
  reportState,
}: {
  state: Connected;
  reportState: ReportState;
}) {
  const { you, partner, synastry, synastryError } = state;
  const partnerName = partner.displayName;
  const partnerLabel = partnerName ?? "your partner";
  const missing = !you.hasChart || !partner.hasChart;

  return (
    <div className="grid gap-10">
      <section aria-labelledby="connected-heading" className="grid gap-4">
        <div className="grid gap-1">
          <h2 id="connected-heading" className="text-xl font-semibold">
            Connected with {partnerLabel}
          </h2>
          <p className="text-muted-foreground text-sm">
            Since {formatDate(state.connectedAt)}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <BigThreeColumn id="you-heading" heading="You" summary={you} />
          <BigThreeColumn
            id="partner-heading"
            heading={partnerName ?? "Your partner"}
            summary={partner}
          />
        </div>
      </section>

      {synastryError ? (
        <div
          role="alert"
          className="bg-card grid justify-items-start gap-3 rounded-2xl border p-6"
        >
          <p className="font-medium">
            We couldn&apos;t calculate your compatibility facts. Try again.
          </p>
          <Link
            href="/partner"
            className={cn(buttonVariants({ variant: "outline" }), "h-10 px-4")}
          >
            Reload
          </Link>
        </div>
      ) : missing ? (
        <Waiting
          youMissing={!you.hasChart}
          partnerMissing={!partner.hasChart}
          partnerName={partnerName}
        />
      ) : synastry ? (
        <>
          <AspectGroup
            id="supportive-heading"
            title="Supportive"
            intro="Connections that come easily. A smaller orb means a stronger link."
            types={SUPPORTIVE_TYPES}
            aspects={synastry.aspects}
          />
          <AspectGroup
            id="challenging-heading"
            title="Challenging"
            intro="Connections that create friction, and room to grow."
            types={CHALLENGING_TYPES}
            aspects={synastry.aspects}
          />
          {synastry.overlays.bInA && (
            <OverlaySection
              id="theirs-in-yours-heading"
              title="Their planets in your houses"
              overlays={synastry.overlays.bInA}
              direction="theirsInYours"
            />
          )}
          {synastry.overlays.aInB && (
            <OverlaySection
              id="yours-in-theirs-heading"
              title="Your planets in their houses"
              overlays={synastry.overlays.aInB}
              direction="yoursInTheirs"
            />
          )}
          {(synastry.excluded.aMoon || synastry.excluded.bMoon) && (
            <div className="text-muted-foreground grid gap-1 text-sm">
              {synastry.excluded.aMoon && (
                <p>Your Moon is left out because your birth time is unknown.</p>
              )}
              {synastry.excluded.bMoon && (
                <p>
                  {partnerName ? `${partnerName}'s` : "Their"} Moon is left out
                  because their birth time is unknown.
                </p>
              )}
            </div>
          )}
          <ReportCard state={reportState} />
        </>
      ) : null}

      <DisconnectPanel relationshipId={state.relationshipId} />
    </div>
  );
}
