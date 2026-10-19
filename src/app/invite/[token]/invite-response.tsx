"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormError } from "@/components/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/auth/validation";
import { acceptInvite, declineInvite } from "./actions";

const SHARED = [
  "Your display name",
  "Your Sun, Moon and rising signs (your Big Three)",
  "The signs of your planets",
  "Compatibility facts between your two charts",
];

const NEVER_SHARED = [
  "Your birth date, birth time and birthplace",
  "Your account details",
  "Your private AI chats",
];

export function InviteResponse({
  token,
  inviterName,
}: {
  token: string;
  inviterName: string;
}) {
  const [acceptState, acceptAction, accepting] = useActionState(
    acceptInvite,
    {} as FormState,
  );
  const [declineState, declineAction, declining] = useActionState(
    declineInvite,
    {} as FormState,
  );
  const consentErrors = acceptState.fieldErrors?.shareConsent;
  const busy = accepting || declining;

  if (declineState.message) {
    return (
      <div className="bg-card grid gap-6 rounded-3xl border p-6 sm:p-10">
        <h1 className="text-2xl font-semibold tracking-tight">
          {declineState.message}
        </h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Nothing was shared with {inviterName}.
        </p>
        <Link
          href="/dashboard"
          className={buttonVariants({ variant: "outline", className: "h-10" })}
        >
          Go to your dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-card grid gap-6 rounded-3xl border p-6 sm:p-10">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {inviterName} invited you to connect
        </h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          If you accept, you and {inviterName} can explore your compatibility
          together. You can disconnect at any time.
        </p>
      </header>

      <section aria-labelledby="shared-heading" className="grid gap-2">
        <h2 id="shared-heading" className="text-sm font-medium">
          What {inviterName} will see
        </h2>
        <ul className="text-muted-foreground grid list-disc gap-1 pl-5 text-sm">
          {SHARED.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="private-heading" className="grid gap-2">
        <h2 id="private-heading" className="text-sm font-medium">
          Never shared
        </h2>
        <ul className="text-muted-foreground grid list-disc gap-1 pl-5 text-sm">
          {NEVER_SHARED.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <form action={acceptAction} className="grid gap-4">
        <input type="hidden" name="token" value={token} />
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
            <Label htmlFor="shareConsent" className="leading-snug font-normal">
              I agree to share this with {inviterName}
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
        <FormError message={acceptState.error} />
        <Button type="submit" disabled={busy} className="h-10">
          {accepting ? "Accepting…" : "Accept"}
        </Button>
      </form>

      <form action={declineAction} className="grid gap-4">
        <input type="hidden" name="token" value={token} />
        <FormError message={declineState.error} />
        <Button
          type="submit"
          variant="outline"
          disabled={busy}
          className="h-10"
        >
          {declining ? "Declining…" : "Decline"}
        </Button>
      </form>
    </div>
  );
}
