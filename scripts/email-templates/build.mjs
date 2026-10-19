// Builds the Supabase Auth email templates in supabase/templates/ from one
// shared layout. Run with `pnpm emails:build`, then paste each file into
// Supabase > Authentication > Emails (see supabase/templates/README.md).
//
// Values in {{ }} are Supabase (Go template) variables, filled in when the
// email is sent. Email clients need table layouts and inline styles, so this
// intentionally avoids modern CSS.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../supabase/templates",
);

const C = {
  page: "#ffffff",
  divider: "#e8eefc",
  heading: "#0a1840",
  text: "#51608a",
  primary: "#0949eb",
  soft: "#f5f8ff",
};

// Dark-mode palette (Electric sapphire dark), applied by clients that honour
// prefers-color-scheme (Apple Mail, Outlook apps) and Outlook.com's
// [data-ogsc] dark mode. Gmail ignores both and auto-inverts instead.
const D = {
  page: "#020a24",
  card: "#0a1a4a",
  border: "#1c2d66",
  heading: "#eaf0ff",
  text: "#9fb0de",
  link: "#7c9bff",
};
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

/** Link into /auth/confirm, which verifies the token hash on any device. */
const confirmUrl = (type, next) =>
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=${type}&next=${next}`;

/** Primary action: a centred pill button. The raw link is shown later, in the fine print. */
function button(label, href) {
  return {
    html: `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
  <tr>
    <td align="center" bgcolor="${C.primary}" style="border-radius:999px;">
      <a href="${href}" target="_blank" style="display:inline-block;padding:15px 36px;font-family:${FONT};font-size:16px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:999px;">${label}</a>
    </td>
  </tr>
</table>`,
    fallbackHref: href,
  };
}

function code(value) {
  return {
    html: `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
  <tr>
    <td class="ap-code" align="center" bgcolor="${C.soft}" style="padding:18px 28px;border-radius:14px;font-family:'SFMono-Regular',Consolas,monospace;font-size:30px;font-weight:700;letter-spacing:10px;color:${C.heading};">${value}</td>
  </tr>
</table>`,
    fallbackHref: null,
  };
}

/** Dark-mode overrides, keyed to the ap-* classes used in the layout. */
const darkModeStyles = `<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .ap-page { background-color: ${D.page} !important; }
    .ap-heading { color: ${D.heading} !important; }
    .ap-text { color: ${D.text} !important; }
    .ap-rule { border-top-color: ${D.border} !important; }
    .ap-link { color: ${D.link} !important; }
    .ap-code { background-color: ${D.card} !important; color: ${D.heading} !important; }
  }
  [data-ogsc] .ap-heading { color: ${D.heading} !important; }
  [data-ogsc] .ap-text { color: ${D.text} !important; }
  [data-ogsc] .ap-link { color: ${D.link} !important; }
  [data-ogsb] .ap-page { background-color: ${D.page} !important; }
  [data-ogsb] .ap-code { background-color: ${D.card} !important; }
</style>`;

function htmlDocument({ preheader, bodyBg, content }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
${darkModeStyles}
<title>AstraPair</title>
</head>
<body class="ap-page" style="margin:0;padding:0;background:${bodyBg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
${content}
</body>
</html>
`;
}

function messageBlock({ heading, body, action, footnote }) {
  const fallback = action.fallbackHref
    ? `<p class="ap-text" style="margin:14px 0 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.text};text-align:center;">Button not working? Paste this link into your browser:<br><a class="ap-link" href="${action.fallbackHref}" style="color:${C.primary};word-break:break-all;">${action.fallbackHref}</a></p>`
    : "";
  return `<h1 class="ap-heading" style="margin:0 0 12px;font-family:${FONT};font-size:26px;line-height:1.25;font-weight:700;color:${C.heading};text-align:center;">${heading}</h1>
            <p class="ap-text" style="margin:0 0 28px;font-family:${FONT};font-size:16px;line-height:1.6;color:${C.text};text-align:center;">${body}</p>
            ${action.html}
            <p class="ap-text ap-rule" style="margin:36px 0 0;padding-top:22px;border-top:1px solid ${C.divider};font-family:${FONT};font-size:13px;line-height:1.6;color:${C.text};text-align:center;">${footnote}</p>
            ${fallback}`;
}

const DISCLAIMER =
  "Astrology on AstraPair is for entertainment and self-reflection.";

/**
 * Centred, cardless layout: logo mark and wordmark, message, one button,
 * then quieter fine print. The logo is served from the deployed site, so it
 * appears once SiteURL is public.
 */
function layout(t) {
  const footerLink = (href, label) =>
    `<a class="ap-text" href="{{ .SiteURL }}${href}" style="color:${C.text};text-decoration:underline;">${label}</a>`;
  return htmlDocument({
    preheader: t.preheader,
    bodyBg: C.page,
    content: `<table role="presentation" class="ap-page" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
        <tr>
          <td align="center" style="padding:0 0 32px;">
            <img src="{{ .SiteURL }}/brand/email-logo.png" width="56" height="56" alt="" style="display:block;margin:0 auto 12px;border:0;">
            <p style="margin:0;font-family:${FONT};font-size:17px;font-weight:700;text-align:center;"><span class="ap-heading" style="color:${C.heading};">Astra</span><span class="ap-link" style="color:${C.primary};">Pair</span></p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:0 16px;">
            ${messageBlock(t)}
          </td>
        </tr>
        <tr>
          <td class="ap-text" align="center" style="padding:32px 16px 0;font-family:${FONT};font-size:12px;line-height:1.8;color:${C.text};text-align:center;">
            ${DISCLAIMER}<br>
            ${footerLink("/legal/privacy", "Privacy")} &nbsp;&nbsp; ${footerLink("/legal/terms", "Terms")}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`,
  });
}

export const TEMPLATES = [
  {
    file: "confirmation.html",
    supabaseName: "Confirm sign up",
    subject: "Confirm your email for AstraPair",
    preheader: "One click and you can add your birth details.",
    heading:
      "Welcome{{ if .Data.display_name }}, {{ .Data.display_name }}{{ end }}",
    body: "Confirm your email address to finish creating your account. Next, you'll add your birth details and we'll calculate your chart.",
    action: button("Confirm email", confirmUrl("email", "/onboarding")),
    footnote:
      "Didn't sign up? Ignore this email and no account will be created.",
  },
  {
    file: "recovery.html",
    supabaseName: "Reset password",
    subject: "Reset your AstraPair password",
    preheader: "Choose a new password for your account.",
    heading: "Reset your password",
    body: "We received a request to reset the password for {{ .Email }}. Choose a new one with the button below. Open it in any browser.",
    action: button(
      "Choose a new password",
      confirmUrl("recovery", "/reset-password"),
    ),
    footnote:
      "Didn't ask for this? You can ignore this email. Your password won't change.",
  },
  {
    file: "email_change.html",
    supabaseName: "Change email address",
    subject: "Confirm your new AstraPair email",
    preheader: "Confirm the change to your account email.",
    heading: "Confirm your new email",
    body: "You asked to change your AstraPair email from {{ .Email }} to {{ .NewEmail }}. Confirm to finish the change.",
    action: button(
      "Confirm new email",
      confirmUrl("email_change", "/settings"),
    ),
    footnote:
      "Didn't request this? Don't click the button, and change your password from Settings.",
  },
  {
    file: "magic_link.html",
    supabaseName: "Magic link or OTP",
    subject: "Your AstraPair sign-in link",
    preheader: "Sign in with one click.",
    heading: "Sign in to AstraPair",
    body: "Use the button below to sign in as {{ .Email }}. The link works once and expires soon.",
    action: button("Sign in", confirmUrl("email", "/dashboard")),
    footnote: "Didn't try to sign in? You can safely ignore this email.",
  },
  {
    file: "invite.html",
    supabaseName: "Invite user",
    subject: "You're invited to AstraPair",
    preheader: "Accept your invitation and set a password.",
    heading: "You're invited",
    body: "You've been invited to create an AstraPair account for {{ .Email }}. Accept to choose your password and get started.",
    action: button(
      "Accept invitation",
      confirmUrl("invite", "/reset-password"),
    ),
    footnote:
      "Not expecting this? You can ignore this email and no account will be created.",
  },
  {
    file: "reauthentication.html",
    supabaseName: "Reauthentication",
    subject: "Your AstraPair verification code",
    preheader: "Your one-time verification code.",
    heading: "Confirm it's you",
    body: "Enter this code in AstraPair to continue. It works once and expires soon.",
    action: code("{{ .Token }}"),
    footnote:
      "Didn't request a code? Someone may know your password. Change it from Settings.",
  },
];

function readme() {
  const rows = TEMPLATES.map(
    (t) => `| ${t.supabaseName} | ${t.subject} | \`${t.file}\` |`,
  ).join("\n");
  return `# Auth email templates

Generated by \`scripts/email-templates/build.mjs\`. Edit that script, then run
\`pnpm emails:build\`. Do not edit these HTML files by hand.

Supabase only allows custom templates once custom SMTP is configured
(Authentication > Emails > SMTP Settings). Then, for each row, open the
template in Authentication > Emails > Templates, set the subject, and paste
the file's contents into the message body.

| Supabase template | Subject | File |
|---|---|---|
${rows}

Links point at \`/auth/confirm\` with a token hash, so they work when opened
on a different device or browser from the one that requested them.
`;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const t of TEMPLATES) {
  writeFileSync(join(OUT_DIR, t.file), layout(t));
}
writeFileSync(join(OUT_DIR, "README.md"), readme());
console.log(`Wrote ${TEMPLATES.length} templates to supabase/templates/`);
