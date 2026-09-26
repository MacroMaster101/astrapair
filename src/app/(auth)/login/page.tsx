import type { Metadata } from "next";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in · AstraPair" };

const ERROR_MESSAGES: Record<string, string> = {
  link_invalid:
    "That link is invalid or has expired. Sign in, or create your account again.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  const errorMessage =
    typeof params.error === "string" ? ERROR_MESSAGES[params.error] : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome back</CardTitle>
        <CardDescription>Sign in to your AstraPair account.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
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
            className="text-foreground underline underline-offset-4"
          >
            Create an account
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
