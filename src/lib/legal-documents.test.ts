import { describe, expect, it } from "vitest";
import { POLICY_VERSION } from "./legal";
import {
  ASTROLOGY_DISCLAIMER,
  CONTACT_FALLBACK,
  LEGAL_DOCUMENTS,
  LEGAL_SLUGS,
  getLegalDocument,
  parseContactEmail,
} from "./legal-documents";

const allText = (slug: keyof typeof LEGAL_DOCUMENTS) =>
  LEGAL_DOCUMENTS[slug].sections
    .flatMap((s) => [s.heading, ...s.paragraphs])
    .join("\n");

const headingsOf = (slug: keyof typeof LEGAL_DOCUMENTS) =>
  LEGAL_DOCUMENTS[slug].sections.map((s) => s.heading.toLowerCase());

describe("LEGAL_DOCUMENTS", () => {
  it("has terms, privacy and disclaimer", () => {
    expect([...LEGAL_SLUGS].sort()).toEqual(["disclaimer", "privacy", "terms"]);
    for (const slug of LEGAL_SLUGS) {
      expect(LEGAL_DOCUMENTS[slug].title.length).toBeGreaterThan(0);
    }
  });

  it("gives every section a heading and at least one paragraph", () => {
    for (const slug of LEGAL_SLUGS) {
      const { sections } = LEGAL_DOCUMENTS[slug];
      expect(sections.length).toBeGreaterThan(0);
      for (const section of sections) {
        expect(section.heading.trim()).not.toBe("");
        expect(section.paragraphs.length).toBeGreaterThan(0);
        for (const paragraph of section.paragraphs) {
          expect(paragraph.trim()).not.toBe("");
        }
      }
    }
  });

  it("has no repeated heading or paragraph inside a document", () => {
    for (const slug of LEGAL_SLUGS) {
      const { sections } = LEGAL_DOCUMENTS[slug];
      const headings = sections.map((s) => s.heading);
      expect(new Set(headings).size).toBe(headings.length);
      const paragraphs = sections.flatMap((s) => s.paragraphs);
      expect(new Set(paragraphs).size).toBe(paragraphs.length);
    }
  });

  it("uses no em or en dashes", () => {
    for (const slug of LEGAL_SLUGS) {
      expect(allText(slug)).not.toMatch(/[–—]/);
    }
    expect(ASTROLOGY_DISCLAIMER).not.toMatch(/[–—]/);
    expect(CONTACT_FALLBACK).not.toMatch(/[–—]/);
  });

  it("makes no absolute promise about what we do", () => {
    // Only statements the code enforces may say "never": birth details are
    // never shown to a partner.
    for (const slug of LEGAL_SLUGS) {
      const text = allText(slug).toLowerCase();
      expect(text).not.toMatch(/\bguarantee/);
      expect(text).not.toMatch(/\bwe never\b/);
      expect(text).not.toMatch(/\balways\b/);
    }
  });

  it("covers every required privacy topic by heading", () => {
    const headings = headingsOf("privacy");
    const required = [
      "contact",
      "collect",
      "partner sharing",
      "ai",
      "cookies",
      "analytics",
      "retention",
      "deleting your account",
      "your rights",
      "children",
    ];
    for (const topic of required) {
      const found = headings.some((h) =>
        topic === "ai" ? /\bai\b/.test(h) : h.includes(topic),
      );
      expect(found, `privacy heading for "${topic}"`).toBe(true);
    }
  });

  it("covers the terms topics by heading", () => {
    const headings = headingsOf("terms");
    for (const topic of [
      "who can use",
      "account",
      "birth details",
      "partners and acceptable use",
      "astrology and ai",
      "limits",
      "availability",
      "ending",
      "liability",
      "contact",
    ]) {
      expect(
        headings.some((h) => h.includes(topic)),
        `terms heading for "${topic}"`,
      ).toBe(true);
    }
  });

  it("states that birth details are never shown to a partner", () => {
    const text = allText("privacy");
    expect(text).toContain(
      "Your birth date, birth time, birthplace, coordinates and timezone are never shown to your partner.",
    );
  });

  it("says what a partner can see", () => {
    const text = allText("privacy");
    expect(text).toContain("display name");
    expect(text).toContain("Sun, Moon and rising signs");
    expect(text).toContain("the signs of your planets");
    expect(text).toContain("compatibility facts");
  });

  it("describes Google sign-in, the invite cookie and the place search providers", () => {
    const text = allText("privacy");
    expect(text).toContain("Google shares your basic profile");
    expect(text).toContain("astrapair_next");
    expect(text).toContain("Photon");
    expect(text).toContain("komoot");
    expect(text).toContain("Open-Meteo");
  });

  it("does not claim more than the code does", () => {
    const text = allText("privacy");
    // Removal is described as maintenance, not as automatic.
    expect(text).toContain(
      "older entries are removed during regular maintenance",
    );
    expect(text).not.toContain("and then remove them");
    expect(text).toContain(
      "we replace your account id in our security log entries with a reference that is not your account id. Regular maintenance also clears any account id left in those entries.",
    );
    expect(text).toContain("up to 12 months");
    // Backups: no number, a limited period.
    expect(text).toContain("for a limited period");
    const backups = LEGAL_DOCUMENTS.privacy.sections
      .flatMap((section) => section.paragraphs)
      .filter((paragraph) => paragraph.startsWith("Backups:"));
    expect(backups).toHaveLength(1);
    expect(backups[0]).not.toMatch(/\d/);
    // No hosting region, company name, address or governing law.
    for (const slug of LEGAL_SLUGS) {
      expect(allText(slug)).not.toMatch(
        /governing law|jurisdiction|registered (office|address)|\bLtd\b|\bInc\b|\bLLC\b/i,
      );
    }
  });

  it("describes the crisis check without overpromising", () => {
    const text = allText("privacy");
    expect(text).toContain(
      "That question and message are not sent to the AI model, not even with later questions in the same conversation.",
    );
    expect(text).toContain("The check can miss some wording.");
    expect(text).toContain(
      "the assistant is instructed to respond with the same support message",
    );
  });

  it("says what Google shares and which cookie lasts how long", () => {
    const text = allText("privacy");
    expect(text).toContain(
      "Google shares your basic profile with our sign-in provider: your email address, name, profile picture address and a Google account number. AstraPair uses only your email address and name.",
    );
    expect(text).toContain("It lasts up to 7 days");
    expect(text).toContain(
      "A sign-in helper cookie is set when you start signing up, resetting your password or signing in with Google. It lets us finish that step safely. Your browser may keep it for up to about 13 months unless you clear it.",
    );
    expect(text).not.toContain("short-lived");
    expect(text).not.toContain("cannot be traced back");
  });

  it("says where the network address is used and who else may log it", () => {
    const text = allText("privacy");
    expect(text).toContain(
      "when you sign up, start Google sign-in or open an invite link. The app does not store it. Our sign-in and hosting providers keep their own technical logs, which can include network addresses.",
    );
  });

  it("says our authentication provider keeps a sign-in security log", () => {
    const text = allText("privacy");
    expect(text).toContain(
      "Our authentication provider records sign-in events, including your email address and network address, in a security log. We keep that log for no more than 30 days, and this also applies after you delete your account.",
    );
  });

  it("lists the environment name, route kind, request method and error reference among the error report fields", () => {
    const text = allText("privacy");
    expect(text).toContain(
      "the app version, the environment name, the page route, the kind of route (such as a page or an API route), the request method (such as GET or POST), an error reference,",
    );
  });

  it("prints no email address in the documents themselves", () => {
    // The contact address comes only from NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL.
    // Leaving it unset shows the fallback text instead, which is why setting it
    // is a blocker in the launch checklist.
    for (const slug of LEGAL_SLUGS) {
      expect(allText(slug)).not.toContain("@");
    }
    expect(CONTACT_FALLBACK).toContain("Settings");
    expect(CONTACT_FALLBACK).toContain("will be listed here");
    expect(CONTACT_FALLBACK).not.toContain("@");
  });

  it("marks a contact section in privacy and terms only", () => {
    expect(LEGAL_DOCUMENTS.privacy.sections.some((s) => s.contact)).toBe(true);
    expect(LEGAL_DOCUMENTS.terms.sections.some((s) => s.contact)).toBe(true);
    expect(LEGAL_DOCUMENTS.disclaimer.sections.some((s) => s.contact)).toBe(
      false,
    );
  });

  it("tells a person in crisis to use local emergency help", () => {
    const text = allText("disclaimer");
    expect(text).toContain("local emergency number");
    expect(text).toContain("someone you trust");
  });

  it("includes the short disclaimer on the disclaimer page", () => {
    expect(allText("disclaimer")).toContain(ASTROLOGY_DISCLAIMER);
  });
});

describe("ASTROLOGY_DISCLAIMER", () => {
  it("is the exact text", () => {
    expect(ASTROLOGY_DISCLAIMER).toBe(
      "For reflection and entertainment. Astrology isn't a substitute for professional advice.",
    );
  });
});

describe("POLICY_VERSION", () => {
  it("is the date of this version", () => {
    expect(POLICY_VERSION).toBe("2026-10-11");
  });
});

describe("parseContactEmail", () => {
  it("returns a plain address, trimmed", () => {
    expect(parseContactEmail("  privacy@example.com ")).toBe(
      "privacy@example.com",
    );
  });

  it.each([
    undefined,
    "",
    "   ",
    "not an email",
    "javascript:alert(1)",
    "a@b",
    "a@b.com?subject=x y",
    "<a@b.com>",
    "a@b.com, c@d.com",
  ])("returns null for %j", (value) => {
    expect(parseContactEmail(value)).toBeNull();
  });
});

describe("getLegalDocument", () => {
  it("finds known slugs and nothing else", () => {
    expect(getLegalDocument("privacy")?.title).toBe("Privacy Policy");
    expect(getLegalDocument("nope")).toBeNull();
    expect(getLegalDocument("constructor")).toBeNull();
    expect(getLegalDocument("__proto__")).toBeNull();
  });
});
