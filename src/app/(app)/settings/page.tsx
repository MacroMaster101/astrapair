import type { Metadata } from "next";
import Link from "next/link";
import { BackLink } from "@/components/back-link";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getProfile } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Settings · AstraPair" };

export default async function SettingsPage() {
  const profile = await getProfile();

  return (
    <div className="grid gap-6">
      <BackLink href="/dashboard" className="w-fit">
        Back to dashboard
      </BackLink>
      <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
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
          <CardTitle>Password</CardTitle>
          <CardDescription>
            Changing it signs you out on your other devices.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/reset-password"
            className={cn(buttonVariants({ variant: "outline" }), "h-10 px-4")}
          >
            Change password
          </Link>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Privacy</CardTitle>
          <CardDescription>
            Read how we use your data in the{" "}
            <Link
              href="/legal/privacy"
              className="text-primary font-medium underline-offset-4 hover:underline"
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
