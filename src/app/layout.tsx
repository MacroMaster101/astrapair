import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { ThemeProvider } from "@/components/theme/theme-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AstraPair",
  description:
    "Couples-first astrology: birth charts, compatibility, and AI relationship readings.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f9fc" },
    { media: "(prefers-color-scheme: dark)", color: "#080e1b" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The proxy makes a fresh nonce per request for the Content-Security-Policy.
  // Reading it here makes every page render per request, which is accepted.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    // next-themes sets the theme class on <html> before hydration.
    <html
      lang="en"
      data-scroll-behavior="smooth"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* Browser extensions such as Grammarly add attributes to <body> before React loads. */}
      <body
        className="bg-background text-foreground flex min-h-full flex-col"
        suppressHydrationWarning
      >
        <ThemeProvider nonce={nonce}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
