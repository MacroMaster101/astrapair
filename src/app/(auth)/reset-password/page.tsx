import type { Metadata } from "next";
import { AuthHeading } from "@/components/auth-heading";
import { requireUserId } from "@/lib/auth/session";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Choose a new password · AstraPair",
};

// Reached from the emailed reset link (which signs the user in) or from
// Settings. Either way a session is required.
export default async function ResetPasswordPage() {
  await requireUserId();

  return (
    <div className="grid gap-8">
      <AuthHeading
        title="Choose a new password"
        description="Use at least 8 characters. You'll stay signed in on this device."
      />
      <ResetPasswordForm />
    </div>
  );
}
