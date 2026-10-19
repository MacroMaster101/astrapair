import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { LogoLockup } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { POLICY_VERSION } from "@/lib/legal";
import {
  CONTACT_FALLBACK,
  CONTACT_LEAD,
  LEGAL_DOCUMENTS,
  LEGAL_SLUGS,
  getLegalDocument,
  parseContactEmail,
} from "@/lib/legal-documents";

// The copy lives in src/lib/legal-documents.ts. It is a draft: the documents
// need review by a lawyer before launch.

export function generateStaticParams() {
  return LEGAL_SLUGS.map((slug) => ({ slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: PageProps<"/legal/[slug]">): Promise<Metadata> {
  const doc = getLegalDocument((await params).slug);
  return { title: doc ? `${doc.title} · AstraPair` : "AstraPair" };
}

function ContactLine({ email }: { email: string | null }) {
  if (!email) return <p>{CONTACT_FALLBACK}</p>;
  return (
    <p>
      {CONTACT_LEAD}{" "}
      <a
        href={`mailto:${email}`}
        className="text-primary font-medium underline-offset-4 hover:underline"
      >
        {email}
      </a>
      .
    </p>
  );
}

export default async function LegalPage({
  params,
}: PageProps<"/legal/[slug]">) {
  const { slug } = await params;
  const doc = getLegalDocument(slug);
  if (!doc) notFound();
  // Set to exactly "true" once a lawyer has reviewed these documents; until
  // then the page says it is a draft. The literal names let Next.js inline the
  // values when the page is built.
  const reviewed = process.env.NEXT_PUBLIC_LEGAL_REVIEWED === "true";
  const contactEmail = parseContactEmail(
    process.env.NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL,
  );

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
          {reviewed
            ? `Version ${POLICY_VERSION}`
            : `Draft version ${POLICY_VERSION}, pending legal review.`}
        </p>
        <div className="mt-10 grid max-w-[65ch] gap-10 leading-relaxed">
          {doc.sections.map((section) => (
            <section key={section.heading} className="grid gap-4">
              <h2 className="text-xl font-semibold tracking-tight">
                {section.heading}
              </h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.contact ? <ContactLine email={contactEmail} /> : null}
            </section>
          ))}
        </div>
        <nav aria-label="Legal documents" className="mt-16 border-t pt-8">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {LEGAL_SLUGS.filter((s) => s !== slug).map((other) => (
              <li key={other}>
                <Link
                  href={`/legal/${other}`}
                  className="text-primary font-medium underline-offset-4 hover:underline"
                >
                  {LEGAL_DOCUMENTS[other].title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>
    </div>
  );
}
