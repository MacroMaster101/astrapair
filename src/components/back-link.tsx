import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function BackLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex items-center gap-1.5 rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-3",
        className,
      )}
    >
      <ArrowLeft
        aria-hidden
        className="size-4 transition-transform group-hover:-translate-x-0.5"
      />
      {children}
    </Link>
  );
}
