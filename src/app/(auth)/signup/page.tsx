import type { Metadata } from "next";
import Link from "next/link";
import { AuthHeading } from "@/components/auth-heading";
import { GoogleButton, OrDivider } from "@/components/auth/google-button";
import { isGoogleAuthEnabled } from "@/lib/auth/oauth";
import {
  SIGN_IN_PATH,
  onboardingTarget,
  safeNextPath,
} from "@/lib/auth/routes";
import { isBetaGateOn } from "@/lib/beta/gate";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create account · AstraPair" };

export default async function SignUpPage({
  searchParams,
}: PageProps<"/signup">) {
  const params = await searchParams;
  const next =
    safeNextPath(typeof params.next === "string" ? params.next : "", "") ||
    undefined;

  const betaGate = isBetaGateOn();
  const google = isGoogleAuthEnabled();

  return (
    <div className="grid gap-8">
      <AuthHeading
        title="Create your account"
        description="Save your birth chart and compatibility readings."
      />
      <div className="grid gap-5">
        {/* A Google sign-up cannot carry an invite code, so the closed beta
            hides the button here and explains the order instead. */}
        {google && !betaGate && (
          <>
            {/* A new Google user goes through onboarding, as email sign-ups do. */}
            <GoogleButton next={onboardingTarget(next)} />
            <OrDivider />
          </>
        )}
        <SignUpForm next={next} betaGate={betaGate} />
        {google && betaGate && (
          <p className="text-muted-foreground text-sm leading-relaxed">
            Have an invite code? Create your account with email first. You can
            use Google to sign in afterwards with the same email address.
          </p>
        )}
      </div>
      <div className="grid gap-3 text-sm">
        <p className="text-muted-foreground">
          Already have an account?{" "}
          <Link
            href={
              next
                ? `${SIGN_IN_PATH}?next=${encodeURIComponent(next)}`
                : SIGN_IN_PATH
            }
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
