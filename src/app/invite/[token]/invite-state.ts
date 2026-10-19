import { SIGN_IN_PATH } from "@/lib/auth/routes";
import {
  GENERIC_PARTNER_ERROR,
  partnerErrorMessage,
} from "@/lib/partner/errors";
import { invitePath } from "@/lib/partner/next-path";

export const RATE_LIMIT_MESSAGE =
  "Too many attempts. Please wait a little and try again.";

export const UNAVAILABLE = {
  expired: { title: "This invite has expired", code: "invite_expired" },
  used: { title: "This invite was already used", code: "invite_used" },
  revoked: { title: "This invite was cancelled", code: "invite_revoked" },
  not_found: { title: "This invite isn't valid", code: "invite_not_found" },
} as const;

export type Unavailable = keyof typeof UNAVAILABLE;

export type Preview =
  | { kind: "limited" }
  | { kind: "failed" }
  | { kind: "valid"; inviterName: string; isOwn: boolean }
  | { kind: Unavailable };

/** What we need to know about a signed-in viewer of a valid invite. */
export interface Viewer {
  onboarded: boolean;
  /** Whether they are already in an active connection; "error" when the check failed. */
  connection: "connected" | "none" | "error";
}

export type InviteView =
  | { kind: "redirect"; to: string }
  | {
      kind: "notice";
      title: string;
      body: string;
      href: string;
      label: string;
    }
  | {
      kind: "signed_out";
      inviterName: string;
      signUpHref: string;
      signInHref: string;
    }
  | { kind: "respond"; inviterName: string };

/**
 * Decides what the invite page shows. Pure apart from `loadViewer`, which is
 * called only for a signed-in person looking at a valid invite.
 */
export async function resolveInviteView({
  preview,
  token,
  signedIn,
  loadViewer,
}: {
  preview: Preview;
  token: string;
  signedIn: boolean;
  loadViewer: () => Promise<Viewer>;
}): Promise<InviteView> {
  const home = signedIn
    ? { href: "/dashboard", label: "Back to dashboard" }
    : { href: "/", label: "Back to home" };

  if (preview.kind === "limited") {
    return {
      kind: "notice",
      title: "Please slow down",
      body: RATE_LIMIT_MESSAGE,
      ...home,
    };
  }
  if (preview.kind === "failed") {
    return {
      kind: "notice",
      title: "We couldn't load this invite",
      body: GENERIC_PARTNER_ERROR,
      ...home,
    };
  }
  if (preview.kind !== "valid") {
    const { title, code } = UNAVAILABLE[preview.kind];
    return {
      kind: "notice",
      title,
      body: partnerErrorMessage({ message: code }),
      ...home,
    };
  }

  const { inviterName, isOwn } = preview;

  if (!signedIn) {
    const next = encodeURIComponent(invitePath(token));
    return {
      kind: "signed_out",
      inviterName,
      signUpHref: `/signup?next=${next}`,
      signInHref: `${SIGN_IN_PATH}?next=${next}`,
    };
  }

  const viewer = await loadViewer();
  if (!viewer.onboarded) {
    return {
      kind: "redirect",
      to: `/onboarding?next=${encodeURIComponent(invitePath(token))}`,
    };
  }
  if (isOwn) {
    return {
      kind: "notice",
      title: "This is your invite",
      body: partnerErrorMessage({ message: "self_invite" }),
      href: "/partner",
      label: "Go to partner",
    };
  }
  if (viewer.connection === "error") {
    return {
      kind: "notice",
      title: "We couldn't load this invite",
      body: GENERIC_PARTNER_ERROR,
      ...home,
    };
  }
  if (viewer.connection === "connected") {
    return {
      kind: "notice",
      title: "You're already connected",
      body: partnerErrorMessage({ message: "already_connected" }),
      href: "/partner",
      label: "Go to partner",
    };
  }
  return { kind: "respond", inviterName };
}
