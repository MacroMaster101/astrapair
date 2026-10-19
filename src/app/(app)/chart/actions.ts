"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { trackAfterResponse } from "@/lib/analytics/track";
import { requireOnboardedUserId } from "@/lib/auth/session";
import {
  formValues,
  toFieldErrors,
  type FormState,
} from "@/lib/auth/validation";
import {
  BIRTH_DETAIL_FIELDS,
  birthProfileSchema,
} from "@/lib/birth-profile/schema";
import {
  BirthProfileSaveError,
  getCurrentChart,
  getOwnBirthProfile,
  saveBirthProfile,
} from "@/lib/birth-profile/service";

export async function saveBirthDetails(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await requireOnboardedUserId();
  const values = formValues(formData, [...BIRTH_DETAIL_FIELDS]);
  const parsed = birthProfileSchema.safeParse(values);
  if (!parsed.success) return { ...toFieldErrors(parsed.error), values };

  let chartError: boolean;
  try {
    ({ chartError } = await saveBirthProfile(userId, parsed.data));
  } catch (e) {
    if (!(e instanceof BirthProfileSaveError)) throw e;
    return {
      error: "We couldn't save your birth details. Please try again.",
      values,
    };
  }

  // Runs after the response is sent, so a slow database never holds the page.
  trackAfterResponse("birth_profile_completed", userId);
  if (!chartError) trackAfterResponse("chart_generated", userId);

  revalidatePath("/", "layout");
  redirect("/chart");
}

/**
 * Retry after a calculation failure. The chart is calculated and stored here,
 * so the chart page then loads it; if it fails again the page shows the retry.
 */
export async function recalculateChart(): Promise<void> {
  const userId = await requireOnboardedUserId();
  try {
    const profile = await getOwnBirthProfile();
    if (profile && (await getCurrentChart(profile)).chart) {
      trackAfterResponse("chart_generated", userId);
    }
  } catch {
    // The chart page retries on load and shows the retry button if needed.
    // Fixed message only: errors here can carry profile data.
    console.error("Chart retry failed", { stage: "retry", code: "exception" });
  }
  revalidatePath("/chart");
  redirect("/chart");
}
