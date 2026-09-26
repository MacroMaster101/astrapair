"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormError, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/validation";
import { signIn } from "../actions";

export function SignInForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signIn, {} as FormState);

  return (
    <form action={action} className="grid gap-4" noValidate>
      {next && <input type="hidden" name="next" value={next} />}
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
      <FormField
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        errors={state.fieldErrors?.password}
      />
      <Link
        href="/forgot-password"
        className="text-primary -mt-1 justify-self-end text-sm font-medium underline-offset-4 hover:underline"
      >
        Forgot password?
      </Link>
      <FormError message={state.error} />
      <Button type="submit" disabled={pending} className="h-10">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
