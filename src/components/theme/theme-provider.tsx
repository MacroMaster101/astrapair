"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Follows the OS colour scheme by default; the toggle stores an override.
 *
 * The provider renders a small inline script that sets the theme class before
 * first paint. Under the nonce-based Content Security Policy that script only
 * runs when it carries the request's nonce, so pass `nonce`. A caller that
 * cannot read the request (global-error.tsx) passes `inertScript` instead: the
 * script becomes an unexecuted data block, and the provider applies the theme
 * as soon as React hydrates.
 */
export function ThemeProvider({
  children,
  nonce,
  inertScript,
}: {
  children: React.ReactNode;
  nonce?: string;
  inertScript?: boolean;
}) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      nonce={nonce}
      scriptProps={inertScript ? { type: "application/json" } : undefined}
    >
      {children}
    </NextThemesProvider>
  );
}
