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
import { accountRequiresPassword } from "@/lib/account/deletion";
import { getProfile } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import { DeleteAccountPanel } from "./delete-account-panel";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Settings · AstraPair" };

export default async function SettingsPage() {
  const profile = await getProfile();
  const requiresPassword = await accountRequiresPassword();

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
            .
          </CardDescription>
        </CardHeader>
      </Card>
      <Card className="ring-destructive/30">
        <CardHeader>
          <CardTitle>Delete account</CardTitle>
          <CardDescription>
            Permanently delete your AstraPair account. Here is what happens.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <ul className="text-muted-foreground grid list-disc gap-2 pl-5 text-sm leading-relaxed">
            <li>
              Your profile, birth details, charts, conversations and usage
              records are deleted at once.
            </li>
            <li>
              If you are connected, the connection ends. Your shared
              compatibility data and report are deleted for both of you. Your
              partner keeps their own data.
            </li>
            <li>
              Some security logs without your name are kept for up to 12 months,
              and older entries are removed during regular maintenance.
              Anonymous product events are kept without your name or email.
            </li>
            <li>This cannot be undone.</li>
          </ul>
          <DeleteAccountPanel requiresPassword={requiresPassword} />
        </CardContent>
      </Card>
    </div>
  );
}
