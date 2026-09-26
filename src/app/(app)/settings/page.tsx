import type { Metadata } from "next";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getProfile } from "@/lib/auth/session";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Settings · AstraPair" };

export default async function SettingsPage() {
  const profile = await getProfile();

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            How you appear to a connected partner.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm displayName={profile.display_name ?? ""} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Privacy</CardTitle>
          <CardDescription>
            Read how we use your data in the{" "}
            <Link
              href="/legal/privacy"
              className="underline underline-offset-4"
            >
              Privacy Policy
            </Link>
            . Account deletion will be available here before the beta.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
