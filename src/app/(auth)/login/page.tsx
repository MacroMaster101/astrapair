import type { Metadata } from "next";
import Link from "next/link";
import { AuthHeading } from "@/components/auth-heading";
import { GoogleButton, OrDivider } from "@/components/auth/google-button";
import { isGoogleAuthEnabled, oauthErrorMessage } from "@/lib/auth/oauth";
import { safeNextPath } from "@/lib/auth/routes";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in · AstraPair" };

const LINK_INVALID_MESSAGE =
  "That link is invalid or has expired. Sign in, or request a new link.";

/** Fixed copy only: an unknown or repeated ?error= shows nothing. */
function errorMessageFor(error: string | string[] | undefined) {
  if (typeof error !== "string") return undefined;
  if (error === "link_invalid") return LINK_INVALID_MESSAGE;
  return oauthErrorMessage(error) ?? undefined;
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  const safeNext = safeNextPath(next, "");
  const errorMessage = errorMessageFor(params.error);

  return (
    <div className="grid gap-8">
      <AuthHeading
        title="Welcome back"
        description="Sign in to see your chart and readings."
      />
      {errorMessage && (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-5">
        {isGoogleAuthEnabled() && (
          <>
            <GoogleButton next={safeNext || undefined} />
            <OrDivider />
          </>
        )}
        <SignInForm next={next} />
      </div>
      <p className="text-muted-foreground text-sm">
        New to AstraPair?{" "}
        <Link
          href={
            safeNext
              ? `/signup?next=${encodeURIComponent(safeNext)}`
              : "/signup"
          }
          className="text-primary font-medium underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
