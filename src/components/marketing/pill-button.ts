import { cn } from "@/lib/utils";

/** Pill-shaped CTAs for marketing surfaces, built on theme tokens. */
export function pillButton(variant: "primary" | "ghost", className?: string) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-full text-sm font-semibold whitespace-nowrap transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]",
    variant === "primary"
      ? "bg-primary text-primary-foreground shadow-[0_8px_30px_-6px] shadow-primary/40 hover:bg-primary/90"
      : "border-border text-foreground hover:bg-accent border",
    className,
  );
}
