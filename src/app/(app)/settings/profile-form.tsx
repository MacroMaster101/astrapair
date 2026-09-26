"use client";

import { useActionState } from "react";
import { FormError, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/validation";
import { updateProfile } from "./actions";

export function ProfileForm({ displayName }: { displayName: string }) {
  const [state, action, pending] = useActionState(
    updateProfile,
    {} as FormState,
  );

  return (
    <form action={action} className="grid max-w-sm gap-4">
      <FormField
        name="displayName"
        label="Display name"
        defaultValue={displayName}
        autoComplete="nickname"
        required
        maxLength={80}
        errors={state.fieldErrors?.displayName}
      />
      <FormError message={state.error} />
      {state.message && (
        <p
          role="status"
          className="text-sm text-emerald-600 dark:text-emerald-400"
        >
          {state.message}
        </p>
      )}
      <Button type="submit" disabled={pending} className="justify-self-start">
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
