"use client";

import { useActionState } from "react";
import { FormError, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/validation";
import { BETA_CODE_FIELD, BETA_CODE_MAX_LENGTH } from "@/lib/beta/gate";
import { signUp } from "../actions";

export function SignUpForm({
  next,
  betaGate = false,
}: {
  next?: string;
  /** Closed beta: ask for an invite code. Decided on the server (BETA_GATE). */
  betaGate?: boolean;
}) {
  const [state, action, pending] = useActionState(signUp, {} as FormState);

  return (
    <form action={action} className="grid gap-4" noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      {betaGate && (
        <FormField
          name={BETA_CODE_FIELD}
          key={`code-${state.values?.[BETA_CODE_FIELD] ?? ""}`}
          defaultValue={state.values?.[BETA_CODE_FIELD]}
          label="Invite code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="Your invite code"
          required
          maxLength={BETA_CODE_MAX_LENGTH}
          hint="AstraPair is in a private beta. Enter the code you were given."
          errors={state.fieldErrors?.[BETA_CODE_FIELD]}
        />
      )}
      <FormField
        name="displayName"
        // Remount when the echoed value changes; Base UI inputs are uncontrolled.
        key={state.values?.displayName}
        defaultValue={state.values?.displayName}
        label="Display name"
        autoComplete="nickname"
        placeholder="e.g. Alex"
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
        placeholder="you@example.com"
        required
        errors={state.fieldErrors?.email}
      />
      <FormField
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        placeholder="Create a password"
        required
        minLength={8}
        maxLength={72}
        hint="Use 8–72 characters. A few memorable words work well."
        errors={state.fieldErrors?.password}
      />
      <FormError message={state.error} />
      <Button type="submit" disabled={pending} className="h-10">
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
