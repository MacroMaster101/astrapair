"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { trackAfterResponse } from "@/lib/analytics/track";
import { requireOnboardedUserId } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/validation";
import { generateReport } from "@/lib/report/service";

type FailureCode = Extract<
  Awaited<ReturnType<typeof generateReport>>,
  { ok: false }
>["code"];

const MESSAGES: Record<FailureCode, string> = {
  in_progress: "Your report is already being created. Check back in a minute.",
  limit:
    "You've created the maximum number of reports for today. Try again tomorrow.",
  ai_unavailable: "The AI assistant is offline right now. Try again later.",
  invalid_output:
    "We couldn't create a reliable report this time. Please try again.",
  waiting_for_charts: "Both of you need to add birth details first.",
  not_connected: "You're not connected with a partner.",
  error: "Something went wrong. Please try again.",
};

// The form posts nothing; the arguments only satisfy the useActionState signature.
/* eslint-disable @typescript-eslint/no-unused-vars */
export async function generateReportAction(
  _prev: FormState,
  _formData: FormData,
): Promise<FormState> {
  const userId = await requireOnboardedUserId();

  const result = await generateReport();
  if (!result.ok) return { error: MESSAGES[result.code] };

  // Only a report a model call just produced; before the redirect, which throws.
  if (result.generated) trackAfterResponse("report_generated", userId);

  revalidatePath("/partner");
  revalidatePath("/partner/report");
  redirect("/partner/report");
}
/* eslint-enable @typescript-eslint/no-unused-vars */
