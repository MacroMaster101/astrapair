import {
  HeartHandshake,
  MessagesSquare,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LogoLockup } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { getProfile } from "@/lib/auth/session";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Welcome · AstraPair" };

const POINTS = [
  {
    icon: HeartHandshake,
    text: "AstraPair turns two birth charts into a compatibility reading you can explore together.",
  },
  {
    icon: Sparkles,
    text: "Astrology here is for entertainment and self-reflection. It is not a scientific prediction, and not medical, legal, financial, or relationship advice.",
  },
  {
    icon: ShieldCheck,
    text: "Your birth details calculate your chart. They are shared with a partner only after you both agree to connect.",
  },
  {
    icon: MessagesSquare,
    text: "When you ask the AI assistant a question, the relevant chart data is sent to our AI provider to answer it.",
  },
];

export default async function OnboardingPage() {
  const profile = await getProfile();
  if (profile.onboarded_at) redirect("/dashboard");

  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-4 sm:px-6">
        <LogoLockup />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          {/* The only way out of onboarding without accepting is to sign out. */}
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="bg-card grid w-full max-w-lg gap-8 rounded-3xl border p-6 sm:p-10">
          <header className="grid gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              Welcome{profile.display_name ? `, ${profile.display_name}` : ""}
            </h1>
            <p className="text-muted-foreground">
              A few things to know before you begin.
            </p>
          </header>
          <ul className="grid gap-4">
            {POINTS.map((point) => (
              <li key={point.text} className="flex gap-3">
                <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full">
                  <point.icon aria-hidden className="size-4" />
                </span>
                <p className="text-muted-foreground pt-1 text-sm leading-relaxed">
                  {point.text}
                </p>
              </li>
            ))}
          </ul>
          <OnboardingForm />
        </div>
      </main>
    </div>
  );
}
