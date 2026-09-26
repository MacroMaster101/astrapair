import type { Metadata } from "next";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = { title: "Check your email · AstraPair" };

export default async function CheckEmailPage({
  searchParams,
}: PageProps<"/check-email">) {
  const { email } = await searchParams;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Check your email</CardTitle>
        <CardDescription>
          We sent a confirmation link to{" "}
          {typeof email === "string" ? (
            <strong>{email}</strong>
          ) : (
            "your email address"
          )}
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="text-muted-foreground grid gap-2 text-sm">
        <p>
          Open the link to confirm your account, then you&apos;ll finish setting
          up.
        </p>
        <p>
          Didn&apos;t get it? Check your spam folder, or{" "}
          <Link
            href="/signup"
            className="text-foreground underline underline-offset-4"
          >
            try again
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}
