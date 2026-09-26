import Image from "next/image";
import { cn } from "@/lib/utils";

/** Full stacked logo (mark above wordmark), for hero placements. */
export function Logo({
  className,
  priority,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/brand/astrapair-logo.webp"
      alt="AstraPair"
      width={720}
      height={565}
      priority={priority}
      className={cn("h-auto w-64", className)}
    />
  );
}

/**
 * Horizontal lockup for headers: the mark plus a live-text wordmark, which
 * stays legible at small sizes where the stacked logo's lettering would not.
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
        <span className="text-brand-navy">Astra</span>
        <span className="from-brand-blue to-brand-violet bg-linear-to-r bg-clip-text text-transparent">
          Pair
        </span>
      </span>
    </span>
  );
}
