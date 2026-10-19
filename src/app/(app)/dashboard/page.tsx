import type { Metadata } from "next";
import Image from "next/image";
import { HeartHandshake, MessageCircle, Orbit } from "lucide-react";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { bigThreeSigns } from "@/components/chart/big-three-values";
import { buttonVariants } from "@/components/ui/button";
import { getProfile } from "@/lib/auth/session";
import {
  getCurrentChart,
  getOwnBirthProfile,
} from "@/lib/birth-profile/service";
import {
  getPartnerOverview,
  type PartnerOverview,
} from "@/lib/partner/service";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard · AstraPair" };

function partnerCard(state: PartnerOverview | null): {
  description: string;
  action: string;
} {
  if (!state)
    return {
      description: "We couldn't load your partner details right now.",
      action: "Open partner page",
    };
  if (state.kind === "connected")
    return {
      description: `Connected with ${state.partnerDisplayName ?? "your partner"}.`,
      action: "View compatibility",
    };
  if (state.pendingInvite)
    return {
      description: "Your invite link is waiting to be used.",
      action: "Manage invite",
    };
  return {
    description: "Invite your partner to see how your charts connect.",
    action: "Invite your partner",
  };
}

export default async function DashboardPage() {
  const profile = await getProfile();
  let birth: Awaited<ReturnType<typeof getOwnBirthProfile>> = null;
  let loadFailed = false;
  try {
    birth = await getOwnBirthProfile();
  } catch (e) {
    unstable_rethrow(e);
    loadFailed = true;
  }
  const result = birth ? await getCurrentChart(birth) : null;
  const chart = result?.chart ?? null;

  let partnerState: PartnerOverview | null = null;
  try {
    partnerState = await getPartnerOverview();
  } catch (e) {
    unstable_rethrow(e);
  }
  const partner = partnerCard(partnerState);
  const connected = partnerState?.kind === "connected";

  const values = chart ? bigThreeSigns(chart) : null;
  const bigThree = values
    ? [
        ["Sun", values.sun],
        ["Moon", values.moon],
        ["Ascendant", values.ascendant],
      ]
    : null;

  // When loading failed we can not tell, so send them to the chart page to retry.
  const hasBirth = birth !== null || loadFailed;

  const description = bigThree
    ? "Your Big Three at a glance."
    : loadFailed
      ? "We couldn't load your chart right now."
      : birth
        ? "We couldn't calculate your chart right now."
        : "Add your birth date, time, and place to calculate your chart.";

  return (
    <div className="grid gap-6">
      <header className="dashboard-heading">
        <div>
          <h1>
            Hello{profile.display_name ? `, ${profile.display_name}` : ""}
          </h1>
          <p>A little insight into you and your connection.</p>
        </div>
      </header>
      <div className="dashboard-grid">
        <section
          aria-labelledby="birth-chart-heading"
          className="dashboard-chart bg-card grid content-center gap-5 rounded-2xl border p-6 sm:p-8"
        >
          <div className="dashboard-art">
            <Image src="/images/celestial-pair.png" alt="" fill sizes="420px" />
          </div>
          <div className="grid gap-1">
            <Orbit
              size={22}
              strokeWidth={1.5}
              aria-hidden
              className="text-primary mb-3"
            />
            <h2 id="birth-chart-heading" className="text-xl font-medium">
              Your birth chart
            </h2>
            <p className="text-muted-foreground text-sm">{description}</p>
          </div>
          {bigThree && (
            <dl className="grid gap-3 sm:grid-cols-3">
              {bigThree.map(([label, value]) => (
                <div key={label} className="bg-muted rounded-xl p-3">
                  <dt className="text-muted-foreground text-xs">{label}</dt>
                  <dd className="font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          <Link
            href={hasBirth ? "/chart" : "/chart/birth-details"}
            className={cn(buttonVariants(), "h-10 justify-self-start px-4")}
          >
            {hasBirth ? "View your chart" : "Add birth details"}
          </Link>
        </section>
        <section
          aria-labelledby="partner-heading"
          className="bg-card grid gap-5 rounded-2xl border p-6 sm:p-8"
        >
          <div className="grid gap-1">
            <HeartHandshake
              size={22}
              strokeWidth={1.5}
              aria-hidden
              className="text-primary mb-3"
            />
            <h2 id="partner-heading" className="text-lg font-semibold">
              Your partner
            </h2>
            <p className="text-muted-foreground text-sm">
              {partner.description}
            </p>
          </div>
          <Link
            href="/partner"
            className={cn(buttonVariants(), "h-10 justify-self-start px-4")}
          >
            {partner.action}
          </Link>
        </section>
        <section
          aria-labelledby="ask-heading"
          className="bg-card grid gap-5 rounded-2xl border p-6 sm:p-8"
        >
          <div className="grid gap-1">
            <MessageCircle
              size={22}
              strokeWidth={1.5}
              aria-hidden
              className="text-primary mb-3"
            />
            <h2 id="ask-heading" className="text-lg font-semibold">
              Ask AstraPair
            </h2>
            <p className="text-muted-foreground text-sm">
              Ask about your chart{connected ? " or your relationship" : ""} and
              get an answer based on your placements.
            </p>
          </div>
          <Link
            href="/ask"
            className={cn(buttonVariants(), "h-10 justify-self-start px-4")}
          >
            Ask a question
          </Link>
        </section>
      </div>
    </div>
  );
}
