import { MailCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthHeading } from "@/components/auth-heading";

export const metadata: Metadata = { title: "Check your email · AstraPair" };

export default async function CheckEmailPage({
  searchParams,
}: PageProps<"/check-email">) {
  const { email } = await searchParams;

  return (
    <div className="grid gap-8">
      <span className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-full">
        <MailCheck aria-hidden className="size-6" />
      </span>
      <AuthHeading
        title="Check your email"
        description={
          <>
            We sent a confirmation link to{" "}
            {typeof email === "string" ? (
              <strong className="text-foreground">{email}</strong>
            ) : (
              "your email address"
            )}
            . Open it to finish setting up your account.
          </>
        }
      />
      <p className="text-muted-foreground text-sm leading-relaxed">
        Didn&apos;t get it? Check your spam folder, or{" "}
        <Link
          href="/signup"
          className="text-primary font-medium underline-offset-4 hover:underline"
        >
          try a different email
        </Link>
        . Already confirmed?{" "}
        <Link
          href="/login"
          className="text-primary font-medium underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
        .
      </p>
    </div>
  );
}
