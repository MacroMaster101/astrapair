import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import type { ReportState } from "@/lib/report/service";
import { cn } from "@/lib/utils";
import { GenerateReportButton } from "./generate-report-button";

export const OUT_OF_DATE_NOTE =
  "One of you changed birth details, so this report may be out of date.";

function Body({ state }: { state: ReportState }) {
  switch (state.kind) {
    case "none":
      return (
        <>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Create a reading of your relationship from both charts.
          </p>
          <GenerateReportButton label="Create our report" />
        </>
      );
    case "generating":
      return (
        <>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Your report is being created. This can take a minute or two.
          </p>
          <Link
            href="/partner"
            className={cn(buttonVariants({ variant: "outline" }), "h-10 px-4")}
          >
            Refresh
          </Link>
        </>
      );
    case "ready":
      return (
        <>
          <p className="font-medium">Your report is ready</p>
          {state.outOfDate && (
            <p className="text-muted-foreground text-sm leading-relaxed">
              {OUT_OF_DATE_NOTE}
            </p>
          )}
          <div className="flex flex-wrap items-start gap-3">
            <Link
              href="/partner/report"
              className={cn(buttonVariants(), "h-10 px-4")}
            >
              Read your report
            </Link>
            {state.outOfDate && (
              <GenerateReportButton label="Refresh report" variant="outline" />
            )}
          </div>
        </>
      );
    case "failed":
      return (
        <>
          <p className="text-muted-foreground text-sm leading-relaxed">
            We couldn&apos;t create your report.
          </p>
          <GenerateReportButton label="Try again" />
        </>
      );
    case "unavailable":
      return (
        <>
          <p role="alert" className="text-sm leading-relaxed">
            We couldn&apos;t load your report. Try again.
          </p>
          <Link
            href="/partner"
            className={cn(buttonVariants({ variant: "outline" }), "h-10 px-4")}
          >
            Reload
          </Link>
        </>
      );
    default:
      return null;
  }
}

/** The report's entry point on the partner page. Shows nothing until both charts exist. */
export function ReportCard({ state }: { state: ReportState }) {
  if (state.kind === "waiting_for_charts" || state.kind === "not_connected")
    return null;

  return (
    <section
      aria-labelledby="report-heading"
      className="bg-card grid justify-items-start gap-3 rounded-2xl border p-6"
    >
      <h2 id="report-heading" className="text-xl font-semibold">
        Compatibility report
      </h2>
      <Body state={state} />
    </section>
  );
}
