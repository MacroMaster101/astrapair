"use client";

import { MailCheck } from "lucide-react";
import { useActionState, useState } from "react";
import { FormError, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/validation";
import { requestPasswordReset } from "../actions";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(
    requestPasswordReset,
    {} as FormState,
  );
  // Each submission returns a new state object, so remembering the one the
  // user dismissed lets "try again" show the form without a reload.
  const [dismissed, setDismissed] = useState<FormState | null>(null);

  if (state.message && state !== dismissed) {
    return (
      <div role="status" className="grid gap-4">
        <span className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-full">
          <MailCheck aria-hidden className="size-6" />
        </span>
        <p className="leading-relaxed">
          If an account exists for{" "}
          <strong className="font-semibold">{state.message}</strong>, we sent a
          link to reset your password. Open it in this browser.
        </p>
        <p className="text-muted-foreground text-sm">
          Nothing arrived? Check your spam folder, or{" "}
          <button
            type="button"
            onClick={() => setDismissed(state)}
            className="text-primary font-medium underline-offset-4 hover:underline"
          >
            try again
          </button>
          .
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormField
        name="email"
        // Remount when the echoed value changes; Base UI inputs are uncontrolled.
        key={state.values?.email}
        defaultValue={state.values?.email}
        label="Email"
        type="email"
        autoComplete="email"
        required
        errors={state.fieldErrors?.email}
      />
      <FormError message={state.error} />
      <Button type="submit" disabled={pending} className="h-10">
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
