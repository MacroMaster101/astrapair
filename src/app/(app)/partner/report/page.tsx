import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ReportView } from "@/components/report/report-view";
import { requireOnboardedUserId } from "@/lib/auth/session";
import { getReportState } from "@/lib/report/service";

export const metadata: Metadata = { title: "Compatibility report · AstraPair" };
// Refreshing the report runs a local model, which can take minutes.
export const maxDuration = 300;

export default async function ReportPage() {
  await requireOnboardedUserId();
  const state = await getReportState();
  if (state.kind !== "ready") redirect("/partner");

  return <ReportView report={state.report} outOfDate={state.outOfDate} />;
}
