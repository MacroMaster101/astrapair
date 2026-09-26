import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getProfile } from "@/lib/auth/session";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Welcome · AstraPair" };

export default async function OnboardingPage() {
  const profile = await getProfile();
  if (profile.onboarded_at) redirect("/dashboard");

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>
            Welcome{profile.display_name ? `, ${profile.display_name}` : ""}
          </CardTitle>
          <CardDescription>
            A few things to know before you begin.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <ul className="text-muted-foreground grid list-disc gap-2 pl-5 text-sm">
            <li>
              AstraPair turns two birth charts into a relationship-compatibility
              reading you can explore together.
            </li>
            <li>
              Astrology is offered for{" "}
              <strong>entertainment and self-reflection</strong>. It is not a
              scientific prediction and is not medical, legal, financial, or
              relationship advice.
            </li>
            <li>
              Your birth details are used to calculate your chart. They are
              shared with a partner only after you both explicitly agree to
              connect.
            </li>
            <li>
              When you ask the AI assistant a question, the relevant chart data
              is sent to our AI provider to generate an answer.
            </li>
          </ul>
          <OnboardingForm />
        </CardContent>
      </Card>
    </main>
  );
}
