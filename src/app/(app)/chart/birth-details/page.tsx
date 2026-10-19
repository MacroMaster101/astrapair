import type { Metadata } from "next";
import Link from "next/link";
import { BackLink } from "@/components/back-link";
import { getProfile } from "@/lib/auth/session";
import { isoToday } from "@/lib/birth-profile/schema";
import { getOwnBirthProfile } from "@/lib/birth-profile/service";
import { BirthDetailsForm } from "./birth-details-form";

export const metadata: Metadata = { title: "Birth details · AstraPair" };

export default async function BirthDetailsPage() {
  const [profile, birth] = await Promise.all([
    getProfile(),
    getOwnBirthProfile(),
  ]);

  return (
    <div className="grid max-w-xl gap-8">
      <BackLink href={birth ? "/chart" : "/dashboard"} className="w-fit">
        {birth ? "Back to your chart" : "Back to dashboard"}
      </BackLink>
      <header className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Your birth details
        </h1>
        <p className="text-muted-foreground leading-relaxed">
          We use these to calculate your chart. They stay private: a connected
          partner sees only your display name, Big Three and planet signs, and
          your shared compatibility facts.{" "}
          <Link
            href="/legal/privacy"
            className="text-primary font-medium underline-offset-4 hover:underline"
          >
            How we use your data
          </Link>
        </p>
      </header>
      <BirthDetailsForm
        today={isoToday()}
        defaults={{
          displayName: birth?.displayName ?? profile.display_name ?? "",
          birthDate: birth?.input.birthDate ?? "",
          birthTime: birth?.input.birthTime ?? "",
          accuracy: birth?.input.accuracy ?? "exact",
          place: birth
            ? {
                label: birth.placeLabel,
                latitude: birth.input.latitude,
                longitude: birth.input.longitude,
                timezone: birth.input.timezone,
              }
            : null,
        }}
      />
    </div>
  );
}
