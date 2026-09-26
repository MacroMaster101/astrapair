"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/** Follows the OS colour scheme by default; the toggle stores an override. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
