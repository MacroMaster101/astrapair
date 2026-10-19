import Link from "next/link";
import { LogoLockup } from "@/components/brand/logo";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-container footer-main">
        <div>
          <Link href="/" aria-label="AstraPair home">
            <LogoLockup />
          </Link>
          <p>Written in the stars. Explored together.</p>
        </div>
        <nav aria-label="Footer">
          <Link href="/legal/terms">Terms</Link>
          <Link href="/legal/privacy">Privacy</Link>
          <Link href="/legal/disclaimer">Disclaimer</Link>
          <Link href="/login">Sign in</Link>
        </nav>
      </div>
      <div className="site-container footer-bottom">
        <p>© {new Date().getFullYear()} AstraPair</p>
        <p>
          Astrology on AstraPair is for entertainment and self-reflection, not
          professional advice.
        </p>
      </div>
    </footer>
  );
}
