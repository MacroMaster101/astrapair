"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { reportBoundaryError } from "@/lib/monitoring/client";
import { cn } from "@/lib/utils";

// No error details are shown: they can contain data the person should not see.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportBoundaryError({ name: error.name, digest: error.digest });
  }, [error]);

  return (
    <div
      role="alert"
      className="bg-card mx-auto grid max-w-md justify-items-start gap-4 rounded-2xl border p-6"
    >
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          We couldn&apos;t load this page. Try again in a moment.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="h-10 px-4" onClick={() => reset()}>
          Try again
        </Button>
        <Link
          href="/dashboard"
          className={cn(buttonVariants({ variant: "outline" }), "h-10 px-4")}
        >
          Go to your dashboard
        </Link>
      </div>
    </div>
  );
}
