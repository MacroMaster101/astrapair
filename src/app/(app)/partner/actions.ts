"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { trackAfterResponse } from "@/lib/analytics/track";
import { requireOnboardedUserId } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/validation";
import { POLICY_VERSION } from "@/lib/legal";
import {
  GENERIC_PARTNER_ERROR,
  logUnmappedPartnerError,
  partnerErrorCode,
  partnerErrorMessage,
} from "@/lib/partner/errors";
import { generateInviteToken } from "@/lib/partner/token";
import { createRateLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const inviteLimiter = createRateLimiter({ limit: 10, windowMs: 3_600_000 });

const RATE_LIMIT_MESSAGE =
  "Too many attempts. Please wait a little and try again.";
const CONSENT_MESSAGE = "Tick the box to confirm what you're sharing.";

/** Server Actions reject cross-origin requests, so the Origin header is our own site. */
async function siteOrigin(): Promise<string> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  return `https://${h.get("host") ?? ""}`;
}

export async function createInviteLink(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await requireOnboardedUserId();

  if (formData.get("shareConsent") === null) {
    return { fieldErrors: { shareConsent: [CONSENT_MESSAGE] } };
  }
  if (!inviteLimiter.check(userId)) return { error: RATE_LIMIT_MESSAGE };

  const { token, tokenHash } = generateInviteToken();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_invite", {
    p_token_hash: tokenHash,
    p_policy_version: POLICY_VERSION,
  });
  if (error) {
    logUnmappedPartnerError("create invite", error);
    return { error: partnerErrorMessage(error) };
  }

  trackAfterResponse("partner_invited", userId);

  // Refreshes the pending-invite details. The invite panel keeps its position in
  // the page, so the new link stays on screen until the person copies it.
  revalidatePath("/partner");
  return {
    message: `${await siteOrigin()}/invite/${token}`,
    values: { expiresAt: String(data) },
  };
}

export async function cancelInvite(): Promise<void> {
  await requireOnboardedUserId();
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_invite");
  if (error) throw new Error("Failed to cancel invite");
  revalidatePath("/partner");
}

const disconnectSchema = z.object({ relationshipId: z.uuid() });

export async function disconnect(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireOnboardedUserId();

  const parsed = disconnectSchema.safeParse({
    relationshipId: String(formData.get("relationshipId") ?? ""),
  });
  if (!parsed.success) return { error: GENERIC_PARTNER_ERROR };

  const supabase = await createClient();
  const { error } = await supabase.rpc("end_relationship", {
    p_relationship_id: parsed.data.relationshipId,
  });
  // Already disconnected (for example from a stale page): same result as success.
  if (error && partnerErrorCode(error) !== "not_a_member") {
    logUnmappedPartnerError("disconnect", error);
    return { error: partnerErrorMessage(error) };
  }

  revalidatePath("/", "layout");
  redirect("/partner");
}
