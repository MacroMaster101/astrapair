"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { FormError, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/validation";
import { deleteAccountAction, signInAgainAction } from "./actions";

function ConfirmRegion({
  onCancel,
  requiresPassword,
}: {
  onCancel: () => void;
  requiresPassword: boolean;
}) {
  const [state, action, pending] = useActionState(
    deleteAccountAction,
    {} as FormState,
  );
  const first = useRef<HTMLInputElement>(null);

  // Move focus into the confirmation when it opens.
  useEffect(() => {
    first.current?.focus();
  }, []);

  return (
    <div
      id="delete-account-confirm"
      role="alertdialog"
      aria-labelledby="delete-account-confirm-title"
      aria-describedby="delete-account-confirm-text"
      aria-busy={pending}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !pending) onCancel();
      }}
      className="bg-muted grid gap-4 rounded-xl p-4"
    >
      <div className="grid gap-1">
        <h3 id="delete-account-confirm-title" className="font-semibold">
          Delete your account for good?
        </h3>
        <p
          id="delete-account-confirm-text"
          className="text-muted-foreground text-sm leading-relaxed"
        >
          {requiresPassword
            ? "This cannot be undone. To confirm, type DELETE and enter your current password."
            : "This cannot be undone. To confirm, type DELETE. For your security, you also need to have signed in within the last 10 minutes."}
        </p>
      </div>
      <form action={action} className="grid max-w-sm gap-4">
        {!requiresPassword && (
          <input type="hidden" name="method" value="recent_sign_in" />
        )}
        <FormField
          ref={first}
          name="confirmation"
          label="Type DELETE to confirm"
          defaultValue={state.values?.confirmation ?? ""}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
          errors={state.fieldErrors?.confirmation}
        />
        {requiresPassword && (
          <FormField
            name="password"
            type="password"
            label="Current password"
            autoComplete="current-password"
            required
            errors={state.fieldErrors?.password}
          />
        )}
        <FormError message={state.error} />
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="destructive"
            disabled={pending}
            className="h-10 px-4"
          >
            {pending ? "Deleting…" : "Yes, delete my account"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={onCancel}
            className="h-10 px-4"
          >
            Cancel
          </Button>
        </div>
      </form>
      {state.code === "reauth_required" && (
        // Its own form: signing out must not submit the delete form.
        <form action={signInAgainAction}>
          <Button
            type="submit"
            variant="outline"
            disabled={pending}
            className="h-10 px-4"
          >
            Sign in again
          </Button>
        </form>
      )}
    </div>
  );
}

export function DeleteAccountPanel({
  requiresPassword = true,
}: {
  /** False for an account with no password (Google only). */
  requiresPassword?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <div className="grid gap-4">
      <Button
        ref={trigger}
        type="button"
        variant="destructive"
        className="h-10 justify-self-start px-4"
        aria-expanded={open}
        aria-controls="delete-account-confirm"
        onClick={() => setOpen(true)}
      >
        Delete account
      </Button>
      {open && (
        <ConfirmRegion onCancel={close} requiresPassword={requiresPassword} />
      )}
    </div>
  );
}
