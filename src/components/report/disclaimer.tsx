import { ASTROLOGY_DISCLAIMER } from "@/lib/legal-documents";
import { cn } from "@/lib/utils";

export function Disclaimer({ className }: { className?: string }) {
  return (
    <p
      className={cn("text-muted-foreground text-xs leading-relaxed", className)}
    >
      {ASTROLOGY_DISCLAIMER}
    </p>
  );
}
