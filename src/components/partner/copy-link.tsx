"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const COPIED_MS = 2000;

export function CopyLink({
  link,
  autoFocus = false,
  describedBy,
}: {
  link: string;
  /** Moves focus to the link on mount so screen readers announce it. */
  autoFocus?: boolean;
  describedBy?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  async function copy() {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // The API is missing (insecure page) or permission was denied.
      setStatus("failed");
      return;
    }
    setStatus("copied");
    timer.current = setTimeout(() => setStatus("idle"), COPIED_MS);
  }

  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <Input
          ref={input}
          readOnly
          value={link}
          aria-label="Invite link"
          aria-describedby={describedBy}
          className="h-10 flex-1"
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button
          type="button"
          variant="outline"
          className="h-10 px-4"
          onClick={copy}
        >
          {status === "copied" ? "Copied" : "Copy"}
        </Button>
      </div>
      <p
        role="status"
        className={
          status === "failed" ? "text-muted-foreground text-sm" : "sr-only"
        }
      >
        {status === "failed" && "Copy it manually from the box above."}
        {status === "copied" && "Link copied."}
      </p>
    </div>
  );
}
