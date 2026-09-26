import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { LogoLockup } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { POLICY_VERSION } from "@/lib/legal";

// Placeholder copy. Final documents require privacy/legal review before beta.
const DOCUMENTS = {
  terms: {
    title: "Terms of Service",
    body: [
      "AstraPair is available only to people aged 18 or older.",
      "Astrology content is provided for entertainment and self-reflection. It is not a scientific prediction and must not be relied on for medical, mental-health, legal, financial, or relationship decisions.",
      "You are responsible for the accuracy of the birth details you enter and for only connecting with a partner who has agreed to connect with you.",
    ],
  },
  privacy: {
    title: "Privacy Policy",
    body: [
      "We collect your account details and the birth details you provide (date, time accuracy, and place) to calculate your natal chart.",
      "Your chart is shared with a partner only after you both explicitly accept a connection. You can disconnect at any time.",
      "When you use the AI assistant, the relevant chart data and your question are sent to our AI provider to generate a response.",
      "You can request deletion of your account and personal data from your settings.",
    ],
  },
  disclaimer: {
    title: "Astrology & AI Disclaimer",
    body: [
      "AstraPair uses traditional Western astrology. Readings describe traditional associations, not facts about you or your relationship.",
      "AI-generated responses may be incomplete or wrong, and they never replace professional advice.",
    ],
  },
} as const;

type Slug = keyof typeof DOCUMENTS;
const SLUGS = Object.keys(DOCUMENTS) as Slug[];

function getDocument(slug: string) {
  return Object.hasOwn(DOCUMENTS, slug) ? DOCUMENTS[slug as Slug] : null;
}

export function generateStaticParams() {
  return Object.keys(DOCUMENTS).map((slug) => ({ slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: PageProps<"/legal/[slug]">): Promise<Metadata> {
  const doc = getDocument((await params).slug);
  return { title: doc ? `${doc.title} · AstraPair` : "AstraPair" };
}

export default async function LegalPage({
  params,
}: PageProps<"/legal/[slug]">) {
  const { slug } = await params;
  const doc = getDocument(slug);
  if (!doc) notFound();

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-4 sm:px-6">
          <BackLink href="/">Back to home</BackLink>
          <div className="flex items-center gap-2">
            <Link href="/" aria-label="AstraPair home">
              <LogoLockup />
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6 md:py-16">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
          {doc.title}
        </h1>
        <p className="text-muted-foreground mt-3 text-sm">
          Draft version {POLICY_VERSION}, pending legal review.
        </p>
        <div className="mt-10 grid max-w-[65ch] gap-5 leading-relaxed">
          {doc.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        <nav aria-label="Legal documents" className="mt-16 border-t pt-8">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {SLUGS.filter((s) => s !== slug).map((other) => (
              <li key={other}>
                <Link
                  href={`/legal/${other}`}
                  className="text-primary font-medium underline-offset-4 hover:underline"
                >
                  {DOCUMENTS[other].title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>
    </div>
  );
}
