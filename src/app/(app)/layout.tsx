import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getProfile } from "@/lib/auth/session";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const profile = await getProfile();
  if (!profile.onboarded_at) redirect("/onboarding");

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b">
        <nav
          aria-label="Main"
          className="mx-auto flex w-full max-w-4xl items-center gap-4 px-4 py-3"
        >
          <Link href="/dashboard" className="font-semibold tracking-tight">
            AstraPair
          </Link>
          <Link
            href="/settings"
            className="text-muted-foreground hover:text-foreground text-sm"
          >
            Settings
          </Link>
          <form action="/auth/signout" method="post" className="ml-auto">
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        {children}
      </main>
    </div>
  );
}
