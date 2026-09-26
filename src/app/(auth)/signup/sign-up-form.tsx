"use client";

import { useActionState } from "react";
import { FormError, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/validation";
import { signUp } from "../actions";

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUp, {} as FormState);

  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormField
        name="displayName"
        // Remount when the echoed value changes; Base UI inputs are uncontrolled.
        key={state.values?.displayName}
        defaultValue={state.values?.displayName}
        label="Display name"
        autoComplete="nickname"
        required
        maxLength={80}
        errors={state.fieldErrors?.displayName}
      />
      <FormField
        name="email"
        key={state.values?.email}
        defaultValue={state.values?.email}
        label="Email"
        type="email"
        autoComplete="email"
        required
        errors={state.fieldErrors?.email}
      />
      <FormField
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        maxLength={72}
        hint="At least 8 characters."
        errors={state.fieldErrors?.password}
      />
      <FormError message={state.error} />
      <Button type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
