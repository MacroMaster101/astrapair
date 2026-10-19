import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getProfile, getUserId } from "@/lib/auth/session";
import { hashInviteToken, isWellFormedToken } from "@/lib/partner/token";
import { createRateLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import {
  resolveInviteView,
  UNAVAILABLE,
  type Preview,
  type Unavailable,
  type Viewer,
} from "./invite-state";
import { InviteViewContent } from "./invite-view";

export const metadata: Metadata = { title: "Partner invite · AstraPair" };

const previewLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

async function clientKey(): Promise<string> {
  // Relies on the hosting platform overwriting X-Forwarded-For; on a host that
  // passes the client's header through, this key can be spoofed.
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip")?.trim() || "unknown";
}

async function loadPreview(token: string): Promise<Preview> {
  if (!isWellFormedToken(token)) return { kind: "not_found" };
  if (!previewLimiter.check(await clientKey())) return { kind: "limited" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_invite_preview", {
    p_token_hash: hashInviteToken(token),
  });
  if (error) {
    console.error("invite preview failed", { code: error.code });
    return { kind: "failed" };
  }

  const row = data?.[0];
  if (row?.state === "valid") {
    return {
      kind: "valid",
      inviterName: row.inviter_name?.trim() || "Someone",
      isOwn: row.is_own,
    };
  }
  if (row && Object.hasOwn(UNAVAILABLE, row.state)) {
    return { kind: row.state as Unavailable };
  }
  return { kind: "not_found" };
}

async function loadViewer(): Promise<Viewer> {
  const profile = await getProfile();
  if (!profile.onboarded_at) return { onboarded: false, connection: "none" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_relationship");
  if (error) {
    console.error("invite relationship check failed", { code: error.code });
    return { onboarded: true, connection: "error" };
  }
  return { onboarded: true, connection: data.length ? "connected" : "none" };
}

export default async function InvitePage({
  params,
}: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const preview = await loadPreview(token);
  const signedIn = Boolean(await getUserId());

  const view = await resolveInviteView({
    preview,
    token,
    signedIn,
    loadViewer,
  });
  if (view.kind === "redirect") redirect(view.to);

  return <InviteViewContent view={view} token={token} />;
}
