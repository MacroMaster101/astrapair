import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Horizontal lockup: the mark plus a live-text wordmark. Colours come from
 * theme tokens, so it reads correctly in light and dark mode.
 */
export function LogoLockup({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Image
        src="/brand/astrapair-mark.webp"
        alt=""
        width={32}
        height={32}
        className="size-8"
      />
      <span className="text-xl font-bold tracking-tight">
        <span className="text-foreground">Astra</span>
        <span className="from-primary to-brand-violet bg-linear-to-r bg-clip-text text-transparent">
          Pair
        </span>
      </span>
    </span>
  );
}
