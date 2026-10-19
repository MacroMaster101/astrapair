"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/routes";
import { requireUserId } from "@/lib/auth/session";
import {
  onboardingSchema,
  toFieldErrors,
  type FormState,
} from "@/lib/auth/validation";
import { POLICY_VERSION } from "@/lib/legal";
import {
  INVITE_NEXT_COOKIE,
  resolveOnboardingNext,
} from "@/lib/partner/next-path";
import { createClient } from "@/lib/supabase/server";

export async function completeOnboarding(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUserId();

  const parsed = onboardingSchema.safeParse({
    ageConfirmed: formData.get("ageConfirmed") !== null,
    policiesAccepted: formData.get("policiesAccepted") !== null,
  });
  if (!parsed.success) return toFieldErrors(parsed.error);

  // Records consents, marks the profile onboarded, and writes an audit event atomically.
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_onboarding", {
    p_policy_version: POLICY_VERSION,
  });
  if (error)
    return { error: "We couldn't save your choices. Please try again." };

  const cookieStore = await cookies();
  const next = resolveOnboardingNext(
    formData.get("next")?.toString(),
    cookieStore.get(INVITE_NEXT_COOKIE)?.value,
  );
  cookieStore.delete(INVITE_NEXT_COOKIE);

  redirect(safeNextPath(next, "/dashboard"));
}
