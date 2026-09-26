import type { Metadata } from "next";
import Link from "next/link";
import { AuthHeading } from "@/components/auth-heading";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create account · AstraPair" };

export default function SignUpPage() {
  return (
    <div className="grid gap-8">
      <AuthHeading
        title="Create your account"
        description="Save your birth chart and compatibility readings."
      />
      <SignUpForm />
      <div className="grid gap-3 text-sm">
        <p className="text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-primary font-medium underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
        <p className="text-muted-foreground text-xs leading-relaxed">
          See how your birth details are used in our{" "}
          <Link href="/legal/privacy" className="underline underline-offset-4">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
