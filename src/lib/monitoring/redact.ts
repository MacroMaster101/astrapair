// Pure redaction helpers for monitoring. No server-only import: the same code
// runs in the browser reporter and in the Sentry beforeSend hooks.

const REDACTED = "[redacted]";
const MAX_DEPTH = 6;
const MAX_ARRAY = 20;
const MAX_KEYS = 20;
const MAX_STRING = 500;
const MAX_STACK = 2000;
// Inputs are cut to this many times the output cap before any regex runs, so
// the work is bounded. Every pattern below is also linear on its own: bounded
// quantifiers, no nested repetition, and anything that needs a decision runs
// in a replacer rather than as an alternation inside a repeat.
const INPUT_FACTOR = 4;

// Case-insensitive substrings. Any key containing one has its value replaced.
const SENSITIVE_KEY_PARTS = [
  "password",
  "token",
  "secret",
  "authorization",
  "cookie",
  "apikey",
  "api_key",
  "key",
  "email",
  "birth",
  "latitude",
  "longitude",
  "timezone",
  "place",
  "question",
  "answer",
  "content",
  "facts",
  "interpretation",
  "body",
  "jwt",
  "session",
  "dsn",
];

const CONNECTION_STRING = /postgres(?:ql)?:\/\/[^\s"'<>]+/gi;
const URL_CREDENTIALS = /(https?:\/\/)[^\s/@:"'<>]+:[^\s/@"'<>]+@/gi;
// Everything after a "?" that follows a non-space character and is itself
// followed by one: URL and path query strings, but not "year? Next".
const QUERY_STRING = /(?<=\S)\?(?=[^\s"'<>)\]])[^\s"'<>]*/g;
// One greedy pass over "eyJ" plus token characters; the replacer checks that
// there are at least two dots. (A three-part pattern would rescan from every
// "eyJ" in a long input.)
const JWT_CANDIDATE = /eyJ[\w.-]*/g;
const BEARER = /Bearer\s+[\w.~+/=-]+/gi;
// Plain-text secrets: password=hunter2, api_key=abcd, place=Colombo. The key
// is bounded and checked in the replacer, not matched with a keyword list.
const KEY_VALUE = /([\w.-]{1,64})=("[^"]*"|'[^']*'|[^\s&,;]+)/g;
const COORDINATE_KEY = /(?:^|[._-])(?:lat|lng|lon|dob)$/i;
const EMAIL = /[\w.%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8}/g;
// Birth details: dates, clock times and coordinates. Not preceded by ":" or a
// word character, so "file.js:12:34" stack positions are left alone.
const ISO_DATE = /(?<![\w.-])\d{4}-\d{2}-\d{2}(?![\d-])/g;
const SLASH_DATE =
  /(?<![\w./])(?:\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}\/\d{1,2}\/\d{1,2})(?![\w/])/g;
const CLOCK_TIME =
  /(?:(?<![\w:.])|(?<=[\d\]]T))\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,9})?(?![\d:])/g;
const COORDINATE_PAIR =
  /(?<![\w.])-?\d{1,3}\.\d{1,15}\s{0,8}[,;/]\s{0,8}-?\d{1,3}\.\d{1,15}(?![\w.])/g;
const LONG_DECIMAL = /(?<![\w.])-?\d+\.\d{3,}(?![\w.])/g;
const LONG_RUN = /[A-Za-z0-9_-]{24,}/g;

// Things that look like long tokens but are identifiers we want to keep:
// UUIDs, snake_case or kebab-case names (constraints, functions), camelCase.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_CHAIN = /^[a-z]+(?:[_-](?:[a-z]+|\d{1,4}))+$/;
// Words, or a capital plus a short number (V2): getUserProfileV2ForRequest.
const CAMEL_CASE = /^[a-z]+(?:[A-Z](?:[a-z]+|\d{1,3}))+$/;
const MAX_IDENTIFIER = 64;

function looksLikeIdentifier(run: string): boolean {
  if (UUID.test(run)) return true;
  if (run.length > MAX_IDENTIFIER) return false;
  return NAME_CHAIN.test(run) || CAMEL_CASE.test(run);
}

function maskJwt(candidate: string): string {
  const core = candidate.replace(/\.+$/, "");
  const dots = core.split(".").length - 1;
  return dots >= 2 ? `[jwt]${candidate.slice(core.length)}` : candidate;
}

function maskKeyValue(match: string, key: string): string {
  const lower = key.toLowerCase();
  const sensitive =
    SENSITIVE_KEY_PARTS.some((part) => lower.includes(part)) ||
    COORDINATE_KEY.test(lower);
  return sensitive ? `${key}=${REDACTED}` : match;
}

function maskString(value: string): string {
  return value
    .replace(CONNECTION_STRING, "[connection-string]")
    .replace(URL_CREDENTIALS, "$1[redacted]@")
    .replace(QUERY_STRING, "?[redacted]")
    .replace(JWT_CANDIDATE, maskJwt)
    .replace(BEARER, "Bearer [redacted]")
    .replace(KEY_VALUE, maskKeyValue)
    .replace(EMAIL, "[email]")
    .replace(ISO_DATE, "[date]")
    .replace(SLASH_DATE, "[date]")
    .replace(CLOCK_TIME, "[time]")
    .replace(COORDINATE_PAIR, "[coordinates]")
    .replace(LONG_DECIMAL, "[number]")
    .replace(LONG_RUN, (run) => (looksLikeIdentifier(run) ? run : "[token]"));
}

function redactBounded(value: string, max: number): string {
  const limit = max * INPUT_FACTOR;
  const masked = maskString(
    value.length > limit ? value.slice(0, limit) : value,
  );
  return masked.length > max ? `${masked.slice(0, max)}...[truncated]` : masked;
}

export function redactString(value: string): string {
  return redactBounded(value, MAX_STRING);
}

// Short or generic names matched whole, so "platform" and "template" are safe.
const SENSITIVE_KEY_NAMES = new Set([
  "lat",
  "lng",
  "lon",
  "dob",
  "ip",
  "name",
  "full_name",
  "fullname",
  "first_name",
  "last_name",
  "display_name",
  "partner_name",
  "prompt",
  "text",
  "input",
  "report",
  "phone",
  "address",
  "city",
]);

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    SENSITIVE_KEY_NAMES.has(lower) ||
    SENSITIVE_KEY_PARTS.some((part) => lower.includes(part))
  );
}

function safeGet(source: object, key: string): unknown {
  try {
    return (source as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function redactInner(
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
): unknown {
  switch (typeof value) {
    case "string":
      return redactString(value);
    case "number":
    case "boolean":
    case "undefined":
      return value;
    case "bigint":
      return value.toString();
    case "function":
      return "[function]";
    case "symbol":
      return "[symbol]";
  }
  if (value === null) return null;

  const obj = value as object;
  if (depth >= MAX_DEPTH) return "[max depth]";
  if (ancestors.has(obj)) return "[circular]";
  // Typed arrays and buffers would become one entry per byte.
  if (ArrayBuffer.isView(obj) || obj instanceof ArrayBuffer) return "[binary]";
  if (obj instanceof Date) {
    return Number.isNaN(obj.getTime()) ? "[invalid date]" : obj.toISOString();
  }

  ancestors.add(obj);
  try {
    if (obj instanceof Error) {
      return {
        name: redactString(String(safeGet(obj, "name") ?? "Error")),
        message: redactString(String(safeGet(obj, "message") ?? "")),
      };
    }
    if (Array.isArray(obj)) {
      const items = obj
        .slice(0, MAX_ARRAY)
        .map((item) => redactInner(item, depth + 1, ancestors));
      if (obj.length > MAX_ARRAY) {
        items.push(`[${obj.length - MAX_ARRAY} more items]`);
      }
      return items;
    }
    const out: Record<string, unknown> = {};
    const keys = Object.keys(obj);
    for (const key of keys.slice(0, MAX_KEYS)) {
      // Keys can carry data too ({"sam@example.com": ...}), so mask them.
      out[redactString(key)] = isSensitiveKey(key)
        ? REDACTED
        : redactInner(safeGet(obj, key), depth + 1, ancestors);
    }
    if (keys.length > MAX_KEYS) {
      out["[more keys]"] = keys.length - MAX_KEYS;
    }
    return out;
  } finally {
    ancestors.delete(obj);
  }
}

/** Deep copy with sensitive keys replaced and every string masked. */
export function redactValue(value: unknown, depth = 0): unknown {
  try {
    return redactInner(value, depth, new WeakSet());
  } catch {
    return "[unredactable]";
  }
}

export interface RedactedError {
  name: string;
  message: string;
  stack?: string;
}

function describeNonError(error: unknown): RedactedError {
  if (typeof error === "string") {
    return { name: "NonError", message: redactString(error) };
  }
  if (typeof error === "object" && error !== null) {
    const rawName = safeGet(error, "name");
    const rawMessage = safeGet(error, "message");
    const name =
      typeof rawName === "string" && rawName
        ? redactString(rawName)
        : "NonError";
    if (typeof rawMessage === "string") {
      return { name, message: redactString(rawMessage) };
    }
    return {
      name,
      message: redactString(JSON.stringify(redactValue(error)) ?? "[object]"),
    };
  }
  return { name: "NonError", message: redactString(String(error)) };
}

/** Name plus a masked message and stack. Never throws. */
export function redactError(error: unknown): RedactedError {
  try {
    if (error instanceof Error) {
      const name = redactString(String(safeGet(error, "name") ?? "Error"));
      let message = "[unreadable]";
      try {
        message = redactString(String(error.message));
      } catch {
        // Keep the placeholder.
      }
      const result: RedactedError = { name, message };
      const stack = safeGet(error, "stack");
      if (typeof stack === "string" && stack) {
        result.stack = redactBounded(stack, MAX_STACK);
      }
      return result;
    }
    return describeNonError(error);
  } catch {
    return { name: "Error", message: "[unredactable]" };
  }
}
