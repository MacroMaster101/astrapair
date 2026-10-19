"use client";

import { Geist, Geist_Mono } from "next/font/google";
import { useEffect } from "react";
import { LogoLockup } from "@/components/brand/logo";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { reportBoundaryError } from "@/lib/monitoring/client";
import { cn } from "@/lib/utils";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Replaces the root layout when it fails, so it owns <html> and <body>. No
// error details are shown: they can contain data the person should not see.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportBoundaryError({ name: error.name, digest: error.digest });
  }, [error]);

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body
        className="bg-background text-foreground flex min-h-full flex-col"
        suppressHydrationWarning
      >
        {/* No request headers here, so no nonce: an inline script would be
            blocked by the CSP. The inert script leaves theming to hydration. */}
        <ThemeProvider inertScript>
          <main className="flex flex-1 items-center justify-center px-4 py-12">
            <div
              role="alert"
              className="bg-card grid w-full max-w-md justify-items-start gap-5 rounded-2xl border p-6"
            >
              <LogoLockup />
              <div className="grid gap-1">
                <h1 className="text-xl font-semibold">Something went wrong</h1>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  We couldn&apos;t load AstraPair. Try again in a moment.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  className="h-10 px-4"
                  onClick={() => reset()}
                >
                  Try again
                </Button>
                {/* A plain link: the app router may be what failed. */}
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a
                  href="/"
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "h-10 px-4",
                  )}
                >
                  Go to the home page
                </a>
              </div>
            </div>
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
