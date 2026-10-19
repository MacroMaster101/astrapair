"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { disconnect } from "@/app/(app)/partner/actions";
import { FormError } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/validation";

export function DisconnectPanel({
  relationshipId,
}: {
  relationshipId: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(disconnect, {} as FormState);
  const trigger = useRef<HTMLButtonElement>(null);
  const keep = useRef<HTMLButtonElement>(null);

  // Move focus into the confirmation when it opens, so keyboard users land on
  // the safe choice.
  useEffect(() => {
    if (open) keep.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <section
      aria-labelledby="disconnect-heading"
      className="bg-card grid gap-4 rounded-2xl border p-6"
    >
      <div className="grid gap-1">
        <h2 id="disconnect-heading" className="text-lg font-semibold">
          End the connection
        </h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          You can disconnect at any time. Either of you can do this.
        </p>
      </div>
      <Button
        ref={trigger}
        type="button"
        variant="outline"
        className="h-10 justify-self-start px-4"
        aria-expanded={open}
        aria-controls="disconnect-confirm"
        onClick={() => setOpen(true)}
      >
        Disconnect
      </Button>

      {open && (
        <div
          id="disconnect-confirm"
          role="alertdialog"
          aria-labelledby="disconnect-confirm-title"
          aria-describedby="disconnect-confirm-text"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !pending) close();
          }}
          className="bg-muted grid gap-4 rounded-xl p-4"
        >
          <div className="grid gap-1">
            <h3 id="disconnect-confirm-title" className="font-semibold">
              Disconnect from your partner?
            </h3>
            <p
              id="disconnect-confirm-text"
              className="text-muted-foreground text-sm leading-relaxed"
            >
              Your shared compatibility facts will be deleted for both of you
              straight away. You can connect again later with a new invite.
            </p>
          </div>
          <form action={action} className="grid gap-3">
            <input type="hidden" name="relationshipId" value={relationshipId} />
            <FormError message={state.error} />
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                variant="destructive"
                disabled={pending}
                className="h-10 px-4"
              >
                {pending ? "Disconnecting…" : "Yes, disconnect"}
              </Button>
              <Button
                ref={keep}
                type="button"
                variant="outline"
                disabled={pending}
                onClick={close}
                className="h-10 px-4"
              >
                Keep connection
              </Button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
