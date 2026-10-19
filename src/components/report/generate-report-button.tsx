"use client";

import { useActionState } from "react";
import { generateReportAction } from "@/app/(app)/partner/report/actions";
import { FormError } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/validation";

export function GenerateReportButton({
  label,
  variant = "default",
}: {
  label: string;
  variant?: "default" | "outline";
}) {
  const [state, action, pending] = useActionState(
    generateReportAction,
    {} as FormState,
  );

  return (
    <form action={action} className="grid justify-items-start gap-3">
      <FormError message={state.error} />
      <Button
        type="submit"
        variant={variant}
        disabled={pending}
        aria-busy={pending}
        className="h-10 px-4"
      >
        {pending ? "Creating your report..." : label}
      </Button>
      <p role="status" className="text-muted-foreground text-sm empty:hidden">
        {pending
          ? "This can take a few minutes. You can leave this page and come back."
          : null}
      </p>
    </form>
  );
}
