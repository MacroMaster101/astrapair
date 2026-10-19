"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { trackAfterResponse } from "@/lib/analytics/track";
import { SIGN_IN_PATH } from "@/lib/auth/routes";
import { getProfile, getUserId, requireUserId } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/validation";
import { POLICY_VERSION } from "@/lib/legal";
import {
  logUnmappedPartnerError,
  partnerErrorMessage,
} from "@/lib/partner/errors";
import { hashInviteToken, isWellFormedToken } from "@/lib/partner/token";
import { createRateLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const acceptLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

const RATE_LIMIT_MESSAGE =
  "Too many attempts. Please wait a little and try again.";
const CONSENT_MESSAGE = "Tick the box to confirm what you're sharing.";
const INVALID_LINK_MESSAGE = partnerErrorMessage({ message: "invalid_token" });

function readToken(formData: FormData): string | null {
  const token = String(formData.get("token") ?? "");
  return isWellFormedToken(token) ? token : null;
}

export async function acceptInvite(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const token = readToken(formData);
  if (!token) return { error: INVALID_LINK_MESSAGE };

  const next = encodeURIComponent(`/invite/${token}`);
  const userId = await getUserId();
  if (!userId) redirect(`${SIGN_IN_PATH}?next=${next}`);

  const profile = await getProfile();
  if (!profile.onboarded_at) redirect(`/onboarding?next=${next}`);

  if (formData.get("shareConsent") === null) {
    return { fieldErrors: { shareConsent: [CONSENT_MESSAGE] } };
  }
  if (!acceptLimiter.check(userId)) return { error: RATE_LIMIT_MESSAGE };

  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_invite", {
    p_token_hash: hashInviteToken(token),
    p_policy_version: POLICY_VERSION,
  });
  if (error) {
    logUnmappedPartnerError("accept invite", error);
    return { error: partnerErrorMessage(error) };
  }

  // Only the invitee accepts, so each connection is counted once. Before the
  // redirect, which throws.
  trackAfterResponse("partner_connected", userId);

  revalidatePath("/", "layout");
  redirect("/partner");
}

export async function declineInvite(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const token = readToken(formData);
  if (!token) return { error: INVALID_LINK_MESSAGE };

  await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase.rpc("decline_invite", {
    p_token_hash: hashInviteToken(token),
  });
  if (error) {
    logUnmappedPartnerError("decline invite", error);
    return { error: partnerErrorMessage(error) };
  }

  return { message: "Invite declined." };
}
