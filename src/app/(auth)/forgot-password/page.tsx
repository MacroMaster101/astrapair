import type { Metadata } from "next";
import Link from "next/link";
import { AuthHeading } from "@/components/auth-heading";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Reset password · AstraPair" };

export default function ForgotPasswordPage() {
  return (
    <div className="grid gap-8">
      <AuthHeading
        title="Forgot your password?"
        description="Enter your email and we'll send you a link to choose a new one."
      />
      <ForgotPasswordForm />
      <p className="text-muted-foreground text-sm">
        Remembered it?{" "}
        <Link
          href="/login"
          className="text-primary font-medium underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
