import type { Metadata } from "next";
import Link from "next/link";
import { AuthHeading } from "@/components/auth-heading";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in · AstraPair" };

const ERROR_MESSAGES: Record<string, string> = {
  link_invalid:
    "That link is invalid or has expired. Sign in, or request a new link.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  const errorMessage =
    typeof params.error === "string" ? ERROR_MESSAGES[params.error] : undefined;

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
      <SignInForm next={next} />
      <p className="text-muted-foreground text-sm">
        New to AstraPair?{" "}
        <Link
          href="/signup"
          className="text-primary font-medium underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
