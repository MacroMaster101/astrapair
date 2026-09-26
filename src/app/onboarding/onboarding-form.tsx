"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormError } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/auth/validation";
import { completeOnboarding } from "./actions";

export function OnboardingForm() {
  const [state, action, pending] = useActionState(
    completeOnboarding,
    {} as FormState,
  );

  return (
    <form action={action} className="grid gap-5">
      <ConsentCheckbox
        name="ageConfirmed"
        errors={state.fieldErrors?.ageConfirmed}
        label="I confirm I am 18 years of age or older."
      />
      <ConsentCheckbox
        name="policiesAccepted"
        errors={state.fieldErrors?.policiesAccepted}
        label={
          <>
            I agree to the{" "}
            <Link
              href="/legal/terms"
              target="_blank"
              className="underline underline-offset-4"
            >
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link
              href="/legal/privacy"
              target="_blank"
              className="underline underline-offset-4"
            >
              Privacy Policy
            </Link>
            .
          </>
        }
      />
      <FormError message={state.error} />
      <Button type="submit" disabled={pending} className="h-10">
        {pending ? "Saving…" : "Continue"}
      </Button>
    </form>
  );
}

function ConsentCheckbox({
  name,
  label,
  errors,
}: {
  name: string;
  label: React.ReactNode;
  errors?: string[];
}) {
  const errorId = `${name}-error`;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-start gap-3">
        <Checkbox
          id={name}
          name={name}
          className="mt-0.5"
          aria-invalid={errors?.length ? true : undefined}
          aria-describedby={errors?.length ? errorId : undefined}
        />
        <Label htmlFor={name} className="leading-snug font-normal">
          {label}
        </Label>
      </div>
      {errors?.length ? (
        <p id={errorId} className="text-destructive pl-7 text-sm">
          {errors[0]}
        </p>
      ) : null}
    </div>
  );
}
