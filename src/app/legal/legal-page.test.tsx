import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import { POLICY_VERSION } from "@/lib/legal";
import { CONTACT_FALLBACK, LEGAL_DOCUMENTS } from "@/lib/legal-documents";
import LegalPage, {
  generateMetadata,
  generateStaticParams,
} from "./[slug]/page";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const renderPage = async (slug: string) =>
  render(await LegalPage({ params: Promise.resolve({ slug }) } as never));

describe("LegalPage", () => {
  it("renders each section as a heading followed by its paragraphs", async () => {
    await renderPage("privacy");
    expect(
      screen.getByRole("heading", { level: 1, name: "Privacy Policy" }),
    ).toBeTruthy();
    const sections = LEGAL_DOCUMENTS.privacy.sections;
    const h2s = screen.getAllByRole("heading", { level: 2 });
    expect(h2s.map((h) => h.textContent)).toEqual(
      sections.map((s) => s.heading),
    );
    for (const section of sections) {
      for (const paragraph of section.paragraphs) {
        expect(screen.getByText(paragraph)).toBeTruthy();
      }
    }
  });

  it("renders every document", async () => {
    for (const slug of ["terms", "privacy", "disclaimer"] as const) {
      await renderPage(slug);
      expect(
        screen.getByRole("heading", {
          level: 1,
          name: LEGAL_DOCUMENTS[slug].title,
        }),
      ).toBeTruthy();
      cleanup();
    }
  });

  it("shows a draft label until the documents are marked as reviewed", async () => {
    vi.stubEnv("NEXT_PUBLIC_LEGAL_REVIEWED", "");
    await renderPage("terms");
    expect(
      screen.getByText(
        `Draft version ${POLICY_VERSION}, pending legal review.`,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(`Version ${POLICY_VERSION}`)).toBeNull();
  });

  it("shows only the version when NEXT_PUBLIC_LEGAL_REVIEWED is exactly true", async () => {
    vi.stubEnv("NEXT_PUBLIC_LEGAL_REVIEWED", "true");
    await renderPage("terms");
    expect(screen.getByText(`Version ${POLICY_VERSION}`)).toBeTruthy();
    expect(screen.queryByText(/pending legal review/)).toBeNull();
  });

  it.each(["TRUE", "yes", "1", " true", "false"])(
    "keeps the draft label when NEXT_PUBLIC_LEGAL_REVIEWED is %j",
    async (value) => {
      vi.stubEnv("NEXT_PUBLIC_LEGAL_REVIEWED", value);
      await renderPage("privacy");
      expect(screen.getByText(/pending legal review/)).toBeTruthy();
    },
  );

  it("keeps the back link and links to the other documents", async () => {
    await renderPage("terms");
    expect(
      screen.getByRole("link", { name: "Back to home" }).getAttribute("href"),
    ).toBe("/");
    const nav = screen.getByRole("navigation", { name: "Legal documents" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((a) => a.getAttribute("href")),
    ).toEqual(["/legal/privacy", "/legal/disclaimer"]);
  });

  it("shows the contact address as a mailto link when it is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL", "privacy@example.com");
    await renderPage("privacy");
    const link = screen.getByRole("link", { name: "privacy@example.com" });
    expect(link.getAttribute("href")).toBe("mailto:privacy@example.com");
    expect(screen.queryByText(CONTACT_FALLBACK)).toBeNull();
  });

  it("shows no address and the fallback text when it is not set", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL", "");
    await renderPage("privacy");
    expect(screen.getByText(CONTACT_FALLBACK)).toBeTruthy();
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(document.body.textContent).not.toContain("@");
  });

  it("ignores a value that is not an email address", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL", "javascript:alert(1)");
    await renderPage("privacy");
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(screen.getByText(CONTACT_FALLBACK)).toBeTruthy();
  });

  it("shows the contact line in the terms but not in the disclaimer", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL", "privacy@example.com");
    await renderPage("terms");
    expect(
      screen.getByRole("link", { name: "privacy@example.com" }),
    ).toBeTruthy();
    cleanup();
    await renderPage("disclaimer");
    expect(screen.queryByRole("link", { name: "privacy@example.com" })).toBe(
      null,
    );
  });

  it("treats an unknown slug as not found", async () => {
    await expect(renderPage("nope")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(renderPage("constructor")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("generateStaticParams and generateMetadata", () => {
  it("lists the three documents", () => {
    expect(generateStaticParams().map((p) => p.slug)).toEqual([
      "terms",
      "privacy",
      "disclaimer",
    ]);
  });

  it("titles the page by document, with a fallback for an unknown slug", async () => {
    expect(
      await generateMetadata({
        params: Promise.resolve({ slug: "privacy" }),
      } as never),
    ).toEqual({ title: "Privacy Policy · AstraPair" });
    expect(
      await generateMetadata({
        params: Promise.resolve({ slug: "nope" }),
      } as never),
    ).toEqual({ title: "AstraPair" });
  });
});
