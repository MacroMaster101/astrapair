"use client";

import { useActionState, useId } from "react";
import { createInviteLink } from "@/app/(app)/partner/actions";
import { FormError } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/auth/validation";
import { CopyLink } from "./copy-link";
import { formatDate } from "./format-date";

export function InvitePanel({
  title,
  note,
  hasPendingInvite,
}: {
  title: string;
  note?: string;
  /** The link is shown only while an invite is pending, so a cancelled link disappears. */
  hasPendingInvite: boolean;
}) {
  const [state, action, pending] = useActionState(
    createInviteLink,
    {} as FormState,
  );
  const headingId = useId();
  const readyId = useId();
  const consentErrors = state.fieldErrors?.shareConsent;
  const expiresAt = state.values?.expiresAt;

  return (
    <section
      aria-labelledby={headingId}
      className="bg-card grid gap-4 rounded-2xl border p-6"
    >
      <div className="grid gap-1">
        <h2 id={headingId} className="text-lg font-semibold">
          {title}
        </h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Send your partner a private link. When they accept, you can both see
          how your charts connect.
        </p>
        {note && (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {note}
          </p>
        )}
      </div>

      {state.message && hasPendingInvite ? (
        <div className="grid gap-3">
          <p id={readyId} className="text-sm font-medium">
            Your invite link is ready.
          </p>
          <CopyLink link={state.message} autoFocus describedBy={readyId} />
          <p className="text-muted-foreground text-sm">
            {expiresAt
              ? `This link works once. Expires ${formatDate(expiresAt)}.`
              : "This link works once."}
          </p>
        </div>
      ) : (
        <form action={action} className="grid gap-4">
          <div className="grid gap-1.5">
            <div className="flex items-start gap-3">
              <Checkbox
                id="shareConsent"
                name="shareConsent"
                className="mt-0.5"
                aria-invalid={consentErrors?.length ? true : undefined}
                aria-describedby={
                  consentErrors?.length ? "shareConsent-error" : undefined
                }
              />
              <Label
                htmlFor="shareConsent"
                className="leading-snug font-normal"
              >
                I agree to share my Big Three, planet signs, and our
                compatibility facts with the person who accepts.
              </Label>
            </div>
            {consentErrors?.length ? (
              <p
                id="shareConsent-error"
                className="text-destructive pl-7 text-sm"
              >
                {consentErrors[0]}
              </p>
            ) : null}
          </div>
          <FormError message={state.error} />
          <Button
            type="submit"
            disabled={pending}
            className="h-10 justify-self-start px-4"
          >
            {pending ? "Creating…" : "Create invite link"}
          </Button>
        </form>
      )}
    </section>
  );
}
