import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Horizontal lockup: the mark plus a live-text wordmark. Colours come from
 * theme tokens, so it reads correctly in light and dark mode.
 */
export function LogoLockup({
  className,
  compact = false,
}: {
  className?: string;
  /** Below the `sm` breakpoint show only the mark; the wordmark stays readable to screen readers. */
  compact?: boolean;
}) {
  return (
    <span
      className={cn(
        "brand-lockup inline-flex items-center gap-2 leading-none",
        className,
      )}
    >
      <Image
        src="/brand/astrapair-mark.webp"
        alt=""
        width={32}
        height={32}
        className="size-8 shrink-0"
      />
      <span
        className={cn(
          "text-xl leading-none font-bold tracking-tight",
          compact && "sr-only sm:not-sr-only",
        )}
      >
        <span className="text-foreground">Astra</span>
        <span className="from-primary to-brand-violet bg-linear-to-r bg-clip-text text-transparent">
          Pair
        </span>
      </span>
    </span>
  );
}
