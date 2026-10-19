import type { Metadata } from "next";
import Link from "next/link";
import { BackLink } from "@/components/back-link";
import { LogoLockup } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";

// The link is a secret: keep it out of search results and Referer headers.
export const metadata: Metadata = {
  title: "Partner invite · AstraPair",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function InviteLayout({ children }: LayoutProps<"/invite">) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-4 sm:px-6">
          <BackLink href="/">Back to home</BackLink>
          <div className="flex items-center gap-2">
            <Link href="/" aria-label="AstraPair home">
              <LogoLockup />
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-lg">{children}</div>
      </main>
    </div>
  );
}
