"use client";

import { CircleCheck } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { FormError, FormField } from "@/components/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/validation";
import { cn } from "@/lib/utils";
import { updatePassword } from "./actions";

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(
    updatePassword,
    {} as FormState,
  );

  if (state.message) {
    return (
      <div role="status" className="grid gap-4">
        <span className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-full">
          <CircleCheck aria-hidden className="size-6" />
        </span>
        <p className="leading-relaxed">
          Your password has been updated. Any other devices signed in to your
          account have been signed out.
        </p>
        <Link
          href="/dashboard"
          className={cn(buttonVariants(), "h-10 justify-self-start px-4")}
        >
          Continue to dashboard
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormField
        name="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        maxLength={72}
        hint="At least 8 characters."
        errors={state.fieldErrors?.password}
      />
      <FormField
        name="confirmPassword"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        required
        errors={state.fieldErrors?.confirmPassword}
      />
      <FormError message={state.error} />
      <Button type="submit" disabled={pending} className="h-10">
        {pending ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}
