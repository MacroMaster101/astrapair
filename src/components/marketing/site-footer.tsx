import Link from "next/link";
import { LogoLockup } from "@/components/brand/logo";

const FOOTER_LINKS = [
  { href: "/legal/terms", label: "Terms" },
  { href: "/legal/privacy", label: "Privacy" },
  { href: "/legal/disclaimer", label: "Disclaimer" },
  { href: "/login", label: "Sign in" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1fr_auto] md:items-start">
        <div className="grid gap-3">
          <LogoLockup />
          <p className="text-muted-foreground max-w-sm text-sm leading-relaxed">
            Astrology on AstraPair is for entertainment and self-reflection, not
            professional advice.
          </p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {FOOTER_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-muted-foreground hover:text-foreground text-sm transition-colors"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="text-muted-foreground/80 text-xs md:col-span-2">
          © {new Date().getFullYear()} AstraPair
        </p>
      </div>
    </footer>
  );
}
