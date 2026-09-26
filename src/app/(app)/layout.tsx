import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoLockup } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { getProfile } from "@/lib/auth/session";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const profile = await getProfile();
  if (!profile.onboarded_at) redirect("/onboarding");

  return (
    <div className="flex flex-1 flex-col">
      <header className="bg-background/80 sticky top-0 z-20 border-b backdrop-blur-md">
        <nav
          aria-label="Main"
          className="mx-auto flex h-16 w-full max-w-4xl items-center gap-6 px-4 sm:px-6"
        >
          <Link href="/dashboard" aria-label="AstraPair dashboard">
            <LogoLockup />
          </Link>
          <Link
            href="/settings"
            className="text-muted-foreground hover:text-foreground text-sm"
          >
            Settings
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <form action="/auth/signout" method="post">
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 md:py-12">
        {children}
      </main>
    </div>
  );
}
