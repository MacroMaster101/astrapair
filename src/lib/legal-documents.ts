// DRAFT legal copy. Every statement below was checked against the code and the
// database migrations, but these documents still need review by a lawyer before
// launch. Things only a person can fill in or confirm (contact address, hosting
// region, backup period, company details, governing law) are listed in the
// launch checklist and are deliberately not written here.

export const ASTROLOGY_DISCLAIMER =
  "For reflection and entertainment. Astrology isn't a substitute for professional advice.";

export interface LegalSection {
  heading: string;
  paragraphs: string[];
  /**
   * The page adds the contact line after this section's paragraphs. It shows
   * the address from NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL, or the fallback text
   * when that is not set.
   */
  contact?: boolean;
}

export interface LegalDocument {
  title: string;
  sections: LegalSection[];
}

export type LegalSlug = "terms" | "privacy" | "disclaimer";

/**
 * Shown where the contact address would be while NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL
 * is not set. No address is printed in the documents themselves: setting the
 * variable is a launch blocker (see the launch checklist).
 */
export const CONTACT_FALLBACK =
  "You can delete your account yourself in Settings. A contact address for other requests will be listed here.";

export const CONTACT_LEAD = "Contact us at";

const EMAIL_SHAPE =
  /^[^\s@<>"'()[\]\\,;:]+@[^\s@<>"'()[\]\\,;:]+\.[^\s@<>"'()[\]\\,;:]+$/;

/** The configured contact address, or null when it is unset or not an email address. */
export function parseContactEmail(raw: string | undefined): string | null {
  const value = raw?.trim();
  return value && EMAIL_SHAPE.test(value) ? value : null;
}

export const LEGAL_DOCUMENTS: Record<LegalSlug, LegalDocument> = {
  terms: {
    title: "Terms of Service",
    sections: [
      {
        heading: "Who can use AstraPair",
        paragraphs: [
          "AstraPair is for people aged 18 or older. You confirm your age when you set up your account.",
          "While AstraPair is a closed beta, you may need an invite code to sign up.",
        ],
      },
      {
        heading: "Your account",
        paragraphs: [
          "Give us a working email address and keep your sign-in details to yourself. You are responsible for what happens under your account.",
          "You can change your display name and birth details in the app, and delete your account in Settings.",
        ],
      },
      {
        heading: "Your birth details",
        paragraphs: [
          "Enter your own birth details, as accurately as you can. Your chart and everything built on it depend on them.",
          "If you do not know your birth time, you can say so. Some parts of a chart, such as the Ascendant and houses, then cannot be worked out.",
        ],
      },
      {
        heading: "Partners and acceptable use",
        paragraphs: [
          "Connect only with someone who has agreed to connect with you. Do not pressure anyone to connect or to share.",
          "Do not use AstraPair to harass, threaten or deceive anyone.",
          "Do not try to reach other people's accounts or data, to break or overload the service, or to get around the limits and safety rules of the AI assistant.",
        ],
      },
      {
        heading: "Astrology and AI",
        paragraphs: [
          "Astrology on AstraPair is for reflection and entertainment. It is not a scientific prediction.",
          "AI answers and reports can be wrong. Please read the Astrology and AI disclaimer, which is part of how you should use the service.",
        ],
      },
      {
        heading: "Limits on use",
        paragraphs: [
          "We set daily limits on AI questions and reports. We may change these limits.",
          "We may limit or suspend an account that breaks these terms or puts the service or other people at risk.",
        ],
      },
      {
        heading: "Availability and changes",
        paragraphs: [
          "AstraPair is a beta. It may change, be unavailable at times, or have mistakes. We may change or remove features.",
          "If we change these terms in a way that matters, we change the version number at the top of this page.",
        ],
      },
      {
        heading: "Ending your use",
        paragraphs: [
          "You can stop using AstraPair at any time and delete your account in Settings. What happens to your data is explained in the Privacy Policy.",
        ],
      },
      {
        heading: "Liability",
        paragraphs: [
          "AstraPair is provided as it is. To the extent the law allows, we are not responsible for decisions you make based on a reading or an AI answer, or for losses caused by the service being unavailable.",
          "Nothing in these terms limits any right you have by law that cannot be limited.",
        ],
      },
      {
        heading: "Contact",
        paragraphs: ["For questions about these terms:"],
        contact: true,
      },
    ],
  },

  privacy: {
    title: "Privacy Policy",
    sections: [
      {
        heading: "Who we are and how to contact us",
        paragraphs: [
          'AstraPair is a web app that turns birth details into a natal chart and, for two people who connect, a compatibility reading. In this policy, "we" means the people who run AstraPair.',
          "This policy explains what we collect, why, who else handles it, and how you can delete it.",
        ],
        contact: true,
      },
      {
        heading: "What we collect",
        paragraphs: [
          "Account details: your email address and a display name. Your password is handled by our sign-in provider and is not kept in our own tables.",
          "If you sign in with Google, Google shares your basic profile with our sign-in provider: your email address, name, profile picture address and a Google account number. AstraPair uses only your email address and name.",
          "Birth details: your birth date, your birth time and how sure you are of it, the name of your birthplace, and its coordinates and timezone.",
          "Charts and readings: the natal chart we calculate from your birth details. If you connect with a partner, we also keep the compatibility facts and the report for the two of you.",
          "Partner connection records: invites you create, whether they were accepted, and when a connection began and ended.",
          "Consent records: your age confirmation, your acceptance of the Terms and Privacy Policy, and your agreement to share with a partner, each with the version and time.",
          "AI conversations: the questions you ask the assistant and its answers, so you can read them again. We also keep usage records, such as the model used and how much text it processed, to apply daily limits.",
          "Security logs: a record of actions such as sign-up, onboarding, changes to a birth profile, invites and connections. They hold internal ids and times, not your name or email.",
          "Product events: see Product analytics below.",
          "Invite code: while the beta is closed, sign-up asks for an invite code. It is checked and counted when you sign up, and we then remove it from your account details where we can.",
          "To limit repeated attempts, our server uses your network address briefly in memory when you sign up, start Google sign-in or open an invite link. The app does not store it. Our sign-in and hosting providers keep their own technical logs, which can include network addresses.",
        ],
      },
      {
        heading: "Why we use your data",
        paragraphs: [
          "To run the service you asked for: to sign you in, calculate and show your chart, answer your questions and, if you choose, build a compatibility reading with a partner.",
          "To share with a partner only when you and they agree. You can withdraw that agreement by disconnecting.",
          "To keep a record of what you agreed to.",
          "To keep the service safe and working, and to see which parts people use. For this we keep security logs and product events, which hold no names, emails or text you write.",
        ],
      },
      {
        heading: "How your chart and AI features work",
        paragraphs: [
          "Your chart is calculated by our own code from your birth details. No outside service is used for the calculation.",
          "AI answers and compatibility reports are written by a language model. The model is run by us or by an AI provider we choose.",
          "To write an answer, we send the model the chart facts we worked out (for example, Venus in Virgo, or how two charts connect), the display names involved, your question, and up to the last 10 messages of that conversation. For a partner, the model gets only their signs and how the two charts connect.",
          "We do not send your birth date, birth time, birthplace, coordinates or timezone to the model. Chart facts such as degrees and houses are worked out from your birth details, so they reflect them.",
          "The assistant is set up not to predict how a relationship will turn out, give scores, diagnose anyone, give medical, money or pregnancy advice, or tell you to end or continue a relationship. We check answers and ask the model to try again if one breaks these rules. These checks can miss things.",
          "An automatic check looks for questions that suggest you may be in danger or thinking of harming yourself. When it finds one, the assistant replies with a fixed supportive message. That question and message are not sent to the AI model, not even with later questions in the same conversation. They stay in your conversation so you can read them. The check can miss some wording. If it does, the assistant is instructed to respond with the same support message.",
          "Your AI conversations are not visible to your partner.",
        ],
      },
      {
        heading: "Partner sharing",
        paragraphs: [
          "Connecting is your choice. One person creates a private invite link. The other person opens it, sees what would be shared, and agrees before anything is shared. The link works once and expires after 7 days. Until it is used or expires, anyone who has the link can see your display name.",
          "When you are connected, your partner can see: your display name, your Sun, Moon and rising signs (your Big Three), the signs of your planets, and the compatibility facts and report built from your two charts.",
          "Your birth date, birth time, birthplace, coordinates and timezone are never shown to your partner. Your account details and AI conversations are not shown either. Signs and compatibility facts can hint at roughly when you were born, and your partner may be told if your birth time is unknown, but the details themselves are not shown.",
          "You can disconnect at any time. Disconnecting deletes the shared compatibility facts, the report and the AI conversations about the relationship, for both of you, straight away. Your own chart and your other AI conversations stay with you.",
          "We keep a short record that the connection existed and ended, and your agreement to share is marked as withdrawn. This record stays while either of you has an account.",
        ],
      },
      {
        heading: "Who processes data for us",
        paragraphs: [
          "Database and sign-in: Supabase stores your data and handles sign-in. Sign-in and password emails are sent through our email provider.",
          "Hosting: our hosting provider serves the app. Like most hosts, it may keep ordinary technical logs, such as network addresses.",
          "Google: if you choose Google sign-in, Google handles that sign-in under its own privacy policy.",
          "Place search: when you search for a birthplace, the text you type is sent from our server to Photon, a place search service by komoot based on OpenStreetMap. If Photon is not available or finds nothing, we send it to the Open-Meteo place search instead. They receive only the place text you typed, not your name or account. Because our server sends it, they do not see your device.",
          "AI provider: the language model that writes AI answers and reports, run by us or by an AI provider we choose. It receives what is described under How your chart and AI features work.",
          "Error reporting: if we turn it on, errors are sent to Sentry. A report holds the type of error, where in the code it happened, the app version, the environment name, the page route, the kind of route (such as a page or an API route), the request method (such as GET or POST), an error reference, and the names and versions of the operating system and runtime. It does not hold error messages, what you typed or your account details. We ask Sentry not to work out your location or address from a report.",
          "AstraPair has no advertising and no third-party analytics or tracking tools.",
        ],
      },
      {
        heading: "Cookies and local storage",
        paragraphs: [
          "AstraPair uses only what it needs to work. We set no tracking or advertising cookies.",
          "Sign-in: cookies from our sign-in provider keep you signed in. A sign-in helper cookie is set when you start signing up, resetting your password or signing in with Google. It lets us finish that step safely. Your browser may keep it for up to about 13 months unless you clear it.",
          "Invite link: if you open an invite link and then sign up with email, a cookie called astrapair_next remembers the link so we can take you back to it after you confirm your email and finish setup. It lasts up to 7 days and is removed when you finish setup or sign out.",
          "Light or dark mode: your choice is saved in your browser's local storage, on your device only.",
        ],
      },
      {
        heading: "Product analytics",
        paragraphs: [
          "We count a small set of events to understand how AstraPair is used: registration, birth profile completed, chart generated, partner invited, partner connected, report generated, AI question asked and account deleted.",
          "Each event is stored with the time and a reference made from your account id and a secret key, in a way that cannot be reversed. The reference is not your account id, email or name. An event holds no birth details, questions, answers or other content.",
          "Events from the same account share the same reference, also after deletion. These counts stay in our own database. They are not sent to an analytics service. They are kept after you delete your account, with no name, email or content attached.",
        ],
      },
      {
        heading: "Retention",
        paragraphs: [
          "We keep your account data until you delete your account. When you do, your profile, birth details, charts, AI conversations and usage records are deleted at once.",
          "Security logs hold internal ids and times, and no names or emails. We keep them for up to 12 months, and older entries are removed during regular maintenance. When you delete your account, we replace your account id in our security log entries with a reference that is not your account id. Regular maintenance also clears any account id left in those entries.",
          "Product events are kept after account deletion, as described above.",
          "Backups: our database provider keeps backups for a limited period. Data you delete can remain in backups for a limited period before they expire.",
          "Our hosting provider may keep technical logs for a limited period.",
          "Our authentication provider records sign-in events, including your email address and network address, in a security log. We keep that log for no more than 30 days, and this also applies after you delete your account.",
        ],
      },
      {
        heading: "Deleting your account",
        paragraphs: [
          "You can delete your account in Settings. You type DELETE and enter your password. If you only use Google sign-in, you are asked to have signed in within the last 10 minutes instead.",
          "Deleted at once: your profile, birth details, charts, AI conversations, usage records, consent records and invites.",
          "If you are connected, the connection ends and is marked as ended. The shared compatibility facts, report and AI conversations about the relationship are deleted for both of you. Your partner keeps their own account, birth details, chart and other AI conversations.",
          "Security logs without your name are kept for up to 12 months, and your account id in them is replaced as described under Retention. Product events are kept without your name or email.",
          "Deleting your account cannot be undone.",
        ],
      },
      {
        heading: "Your rights",
        paragraphs: [
          "You can ask to see the personal data we hold about you, to have it corrected or deleted, and to get a copy of it. You can already change your display name and birth details in the app and delete your account in Settings.",
          "For other requests, use the contact details above. You can withdraw your agreement to share with a partner at any time by disconnecting.",
          "If you are unhappy with how we handle your data, you can complain to your data protection authority. Depending on where you live, you may have other rights too.",
        ],
      },
      {
        heading: "Children",
        paragraphs: [
          "AstraPair is for people aged 18 or older, and we ask you to confirm your age when you sign up. If you think someone under 18 has an account, please tell us using the contact details above.",
        ],
      },
      {
        heading: "International transfers",
        paragraphs: [
          "Our providers may store and process data in countries other than yours. Where your data is held depends on where our hosting and database providers run their servers.",
          "Place search, Google sign-in, error reporting and the AI provider may also handle data in other countries.",
        ],
      },
      {
        heading: "Changes to this policy",
        paragraphs: [
          "When we change this policy in a way that matters, we change the version at the top of this page. The version is the date of the change.",
          "When you agree to the Terms and Privacy Policy, we record the version you agreed to.",
        ],
      },
    ],
  },

  disclaimer: {
    title: "Astrology & AI Disclaimer",
    sections: [
      {
        heading: "In short",
        paragraphs: [
          ASTROLOGY_DISCLAIMER,
          "AstraPair uses traditional Western astrology with the tropical zodiac. Readings describe traditional associations. They are not facts about you or your relationship, and they are not a scientific prediction.",
        ],
      },
      {
        heading: "AI can be wrong",
        paragraphs: [
          "AI answers and reports can be incomplete, unclear or wrong. Read them as one view to think about, not as the truth.",
          "We check answers against the chart facts and filter some kinds of advice. These checks can miss things.",
        ],
      },
      {
        heading: "Not professional advice",
        paragraphs: [
          "Nothing on AstraPair is medical, mental-health, legal, financial or relationship advice. Do not use it to make decisions about your health, medication, pregnancy, money, legal matters, or whether to start, continue or end a relationship.",
          "For those, talk to a qualified professional or someone you trust.",
        ],
      },
      {
        heading: "What the assistant will not do",
        paragraphs: [
          "The assistant is set up not to predict how a relationship will turn out, give scores or percentages, or tell you to break up, stay together, marry or make other major decisions.",
          "It is also set up not to diagnose anyone, give medical, mental-health, pregnancy or money advice, or tell anyone to start, stop or change a medication. It is meant to say so and offer reflective questions instead.",
          "About your partner, it uses only the facts you have both agreed to share.",
        ],
      },
      {
        heading: "If you are in crisis or in danger",
        paragraphs: [
          "AstraPair is not a crisis service. If you are in danger or thinking about harming yourself, please contact your local emergency number or a crisis line in your country, or reach out to someone you trust.",
        ],
      },
    ],
  },
};

export const LEGAL_SLUGS = Object.keys(LEGAL_DOCUMENTS) as LegalSlug[];

export function getLegalDocument(slug: string): LegalDocument | null {
  return Object.hasOwn(LEGAL_DOCUMENTS, slug)
    ? LEGAL_DOCUMENTS[slug as LegalSlug]
    : null;
}
