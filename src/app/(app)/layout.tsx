import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNavigation } from "@/components/app-navigation";
import { LogoLockup } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { getProfile } from "@/lib/auth/session";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const profile = await getProfile();
  if (!profile.onboarded_at) redirect("/onboarding");
  return (
    <div className="app-shell flex flex-1 flex-col">
      <header className="app-topbar">
        <nav aria-label="Main" className="app-topbar-inner">
          <Link href="/dashboard" aria-label="AstraPair dashboard">
            <LogoLockup />
          </Link>
          <AppNavigation />
          <div className="app-account-actions">
            <ThemeToggle />
            <form action="/auth/signout" method="post">
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </nav>
      </header>
      <main className="app-main flex-1">{children}</main>
    </div>
  );
}
