import Link from "next/link";
import { LogoLockup } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { pillButton } from "./pill-button";

const NAV_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#reading", label: "Your reading" },
  { href: "#privacy", label: "Privacy" },
];

export function SiteHeader() {
  return (
    <header className="bg-background/75 sticky top-0 z-20 border-b border-border/60 backdrop-blur-md">
      <nav
        aria-label="Main"
        className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4 sm:px-6 md:gap-8"
      >
        <Link href="/" aria-label="AstraPair home">
          <LogoLockup />
        </Link>
        <ul className="hidden items-center gap-6 md:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="text-muted-foreground hover:text-foreground text-sm transition-colors"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-1 sm:gap-3">
          <ThemeToggle />
          <Link
            href="/login"
            className="text-muted-foreground hover:text-foreground px-1 text-sm font-medium whitespace-nowrap transition-colors sm:px-2"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className={pillButton("primary", "h-9 px-3.5 sm:px-4")}
          >
            Get started
          </Link>
        </div>
      </nav>
    </header>
  );
}
