// No "server-only" here on purpose: vitest.ai-eval.config.mts uses the same
// rules, so the eval and the app cannot disagree about a base URL.

export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The base URL the provider appends `/v1/chat/completions` to, or null when it
 * is not allowed. Rules: https, or http only on localhost; no credentials, query
 * string or fragment; a trailing slash and a trailing `/v1` (the convention of
 * OpenAI's own SDKs) are dropped. The result is built from the parsed URL, so
 * the host that was checked is the host that is called.
 */
export function parseOpenAiBaseUrl(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return DEFAULT_OPENAI_BASE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  // Also catches an empty "?" or "#", which the parser reports as "".
  if (url.search || url.hash || /[?#]/.test(raw)) return null;
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local))
    return null;
  const path = url.pathname.replace(/\/+$/, "").replace(/\/v1$/i, "");
  return `${url.origin}${path}`;
}
