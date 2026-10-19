import type { Metadata } from "next";
import Link from "next/link";
import { ConnectedView } from "@/components/partner/connected-view";
import { InviteSection } from "@/components/partner/invite-section";
import { buttonVariants } from "@/components/ui/button";
import { requireOnboardedUserId } from "@/lib/auth/session";
import { getPartnerState } from "@/lib/partner/service";
import { getReportState, type ReportState } from "@/lib/report/service";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Your partner · AstraPair" };

// The report can be created from this page, and a local model can take minutes.
export const maxDuration = 300;

/**
 * A report that fails to load must not take the partner page down with it.
 * The log is a fixed message with a stage and code, never the error itself.
 */
async function loadReportState(): Promise<ReportState> {
  try {
    return await getReportState();
  } catch {
    console.error("Report state failed", {
      stage: "partner-page",
      code: "exception",
    });
    return { kind: "unavailable" };
  }
}

export default async function PartnerPage() {
  await requireOnboardedUserId();
  const state = await getPartnerState();

  return (
    <div className="grid gap-8">
      <h1 className="text-3xl font-semibold tracking-tight">Your partner</h1>

      {state.kind === "connected" ? (
        <ConnectedView state={state} reportState={await loadReportState()} />
      ) : !state.hasBirthProfile ? (
        <section
          aria-labelledby="birth-first"
          className="bg-card grid justify-items-start gap-4 rounded-2xl border p-6"
        >
          <div className="grid gap-1">
            <h2 id="birth-first" className="text-lg font-semibold">
              Add your birth details first
            </h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Compatibility is worked out from both of your charts. Add your
              birth details, then invite your partner to connect.
            </p>
          </div>
          <Link
            href="/chart/birth-details"
            className={cn(buttonVariants(), "h-10 px-4")}
          >
            Add birth details
          </Link>
        </section>
      ) : (
        <InviteSection pendingInvite={state.pendingInvite} />
      )}
    </div>
  );
}
