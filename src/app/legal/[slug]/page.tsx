import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
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
  const doc = getDocument((await params).slug);
  if (!doc) notFound();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
      <Link href="/" className="text-muted-foreground text-sm hover:underline">
        ← AstraPair
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">
        {doc.title}
      </h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Draft · version {POLICY_VERSION} · pending legal review
      </p>
      <div className="mt-8 grid gap-4 leading-relaxed">
        {doc.body.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
    </main>
  );
}
