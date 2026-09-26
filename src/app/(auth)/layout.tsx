import Link from "next/link";
import { BackLink } from "@/components/back-link";
import { LogoLockup } from "@/components/brand/logo";
import { OrbitVisual } from "@/components/marketing/orbit-visual";
import { ThemeToggle } from "@/components/theme/theme-toggle";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-[100dvh] flex-1 lg:grid-cols-[1fr_1.1fr]">
      {/* Brand panel: the `dark` class pins it to dark tokens in both themes. */}
      <aside className="dark bg-background text-foreground relative hidden border-r flex-col justify-between overflow-hidden p-10 lg:flex">
        <div aria-hidden className="starfield absolute inset-0 opacity-80" />
        <Link href="/" aria-label="AstraPair home" className="relative w-fit">
          <LogoLockup />
        </Link>
        <div className="relative grid gap-8">
          <OrbitVisual className="max-w-xs" />
          <p className="max-w-sm text-3xl leading-tight font-semibold tracking-tight text-balance">
            Two birth charts.{" "}
            <span className="text-muted-foreground">
              One conversation worth having.
            </span>
          </p>
        </div>
        <p className="text-muted-foreground relative max-w-sm text-xs leading-relaxed">
          Astrology on AstraPair is for entertainment and self-reflection, not
          professional advice.
        </p>
      </aside>

      <main className="flex flex-col px-4 py-6 sm:px-10">
        <div className="flex items-center justify-between gap-4">
          <BackLink href="/">Back to home</BackLink>
          <div className="flex items-center gap-2">
            <Link href="/" aria-label="AstraPair home" className="lg:hidden">
              <LogoLockup />
            </Link>
            <ThemeToggle />
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </main>
    </div>
  );
}
