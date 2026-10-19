// Content Security Policy for every page the proxy handles. Pure: no Next
// import, so it runs in the proxy and in tests.

const GOOGLE_ACCOUNTS_ORIGIN = "https://accounts.google.com";

export interface CspOptions {
  nonce: string;
  isDev: boolean;
  /**
   * Whether the request itself arrived over https. `upgrade-insecure-requests`
   * is only sent then: over plain http (a local production run) browsers would
   * upgrade Next's own fetches to https and they would fail.
   */
  isHttps: boolean;
  /** NEXT_PUBLIC_SUPABASE_URL. Anything that is not a valid http(s) URL is ignored. */
  supabaseUrl: string | null;
  /** NEXT_PUBLIC_SENTRY_DSN. Only its ingest origin is ever used. */
  sentryDsn?: string | null;
}

/** 16 random bytes, base64 encoded: a fresh value for every request. */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

interface Origin {
  /** `https://host[:port]`, rebuilt from validated parts. */
  http: string;
  /** The websocket origin that pairs with it (wss for https). */
  ws: string;
}

// Letters, digits, hyphens and dots only: no `;`, `,`, quotes, `*`, spaces or
// brackets, so nothing can end a directive or add a source expression.
const HOSTNAME = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;
const PORT = /^\d{1,5}$/;

/**
 * Validates an http(s) URL and rebuilds its origin from parts, or returns null
 * when it is missing, malformed or not a plain host (localhost and IPv4 are
 * fine). The input is operator-set env, but a bad value must drop that origin
 * rather than alter the policy. A DSN carries a public key as userinfo, which
 * is discarded; anywhere else userinfo makes the value invalid.
 */
function parseOrigin(
  value: string | null | undefined,
  { allowUserinfo = false } = {},
): Origin | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!allowUserinfo && (url.username || url.password)) return null;
  if (!HOSTNAME.test(url.hostname)) return null;
  if (url.port && !PORT.test(url.port)) return null;

  const host = url.port ? `${url.hostname}:${url.port}` : url.hostname;
  return {
    http: `${url.protocol}//${host}`,
    ws: `${url.protocol === "https:" ? "wss:" : "ws:"}//${host}`,
  };
}

export function buildCsp({
  nonce,
  isDev,
  isHttps,
  supabaseUrl,
  sentryDsn,
}: CspOptions): string {
  const supabase = parseOrigin(supabaseUrl);
  const sentry = parseOrigin(sentryDsn, { allowUserinfo: true });

  const connectSrc = ["'self'"];
  if (supabase) connectSrc.push(supabase.http, supabase.ws);
  // The DSN holds a public key and project id; only the host is needed.
  if (sentry) connectSrc.push(sentry.http);
  // Hot reload. 'self' alone does not cover the websocket in every browser.
  if (isDev) {
    connectSrc.push(
      "ws://localhost:*",
      "wss://localhost:*",
      "ws://127.0.0.1:*",
      "wss://127.0.0.1:*",
    );
  }

  // "Continue with Google" is a plain form post to a server action with no
  // JavaScript needed. That response redirects to the Supabase authorize URL
  // and then to accounts.google.com, and Chrome applies form-action to every
  // redirect target of a form submission, so both origins must be listed.
  const formAction = ["'self'"];
  if (supabase) formAction.push(supabase.http);
  formAction.push(GOOGLE_ACCOUNTS_ORIGIN);

  const directives: string[] = [
    "default-src 'self'",
    // The nonce marks the scripts Next.js and next-themes render; 'strict-dynamic'
    // lets those scripts load their own chunks. No 'unsafe-inline' here.
    // React only needs eval in development (debug stack reconstruction).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes (the animation library sets element styles from
    // JavaScript, and React renders style props) cannot carry a nonce, so
    // styles need 'unsafe-inline'. Scripts stay strict, which is what blocks XSS.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src ${connectSrc.join(" ")}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    `form-action ${formAction.join(" ")}`,
    "object-src 'none'",
    // worker-src falls back to script-src, and 'strict-dynamic' blocks workers
    // that carry no nonce. Add `worker-src 'self' blob:` if one is introduced.
  ];
  if (isHttps) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}
