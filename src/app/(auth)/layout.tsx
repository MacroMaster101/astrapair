import Image from "next/image";
import Link from "next/link";
import { BackLink } from "@/components/back-link";
import { LogoLockup } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="auth-shell">
      <aside className="auth-brand-panel">
        <Link href="/" aria-label="AstraPair home">
          <LogoLockup />
        </Link>
        <div className="auth-art">
          <Image
            src="/images/celestial-pair.png"
            alt=""
            fill
            priority
            sizes="50vw"
          />
        </div>
        <div className="auth-brand-copy">
          <h2>
            Two birth charts.
            <br />
            One conversation worth having.
          </h2>
          <p>
            A fresh perspective on you, your person, and what brings you
            together.
          </p>
        </div>
        <p className="auth-disclaimer">
          Astrology on AstraPair is for entertainment and self-reflection, not
          professional advice.
        </p>
      </aside>
      <main className="auth-main">
        <div className="auth-topbar">
          <BackLink href="/">Back to home</BackLink>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              aria-label="AstraPair home"
              className="auth-mobile-logo"
            >
              <LogoLockup />
            </Link>
            <ThemeToggle />
          </div>
        </div>
        <div className="auth-form-wrap">
          <div className="auth-form">{children}</div>
        </div>
      </main>
    </div>
  );
}
