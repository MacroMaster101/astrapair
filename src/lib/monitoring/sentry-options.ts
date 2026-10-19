// Shared by the server and browser Sentry setups. Pure: no server-only import.
//
// Policy: Sentry receives no message text at all. Whatever the SDK captures on
// its own (uncaught exceptions, unhandled rejections) is rebuilt from an
// allowlist in `beforeSend`, so a field we did not think of is dropped rather
// than leaked. The readable, masked message goes to our own console log only.

type Loose = Record<string, unknown>;

export const REDACTED_TEXT = "[redacted]";

/** The only tags that ever reach Sentry. */
export const ALLOWED_TAGS = ["routePath", "routeType", "method", "digest"];

// Error capture only. Excluded on purpose: Console and fetch/http breadcrumbs,
// ContextLines (source text), LocalVariables, Modules, RequestData, and every
// tracing or performance integration.
const ALLOWED_INTEGRATIONS = new Set([
  "EventFilters",
  "InboundFilters",
  "FunctionToString",
  "LinkedErrors",
  "Dedupe",
  "OnUncaughtException",
  "OnUnhandledRejection",
  "GlobalHandlers",
  "Context",
]);

const KEPT_CONTEXTS = ["runtime", "os"];
const KEPT_CONTEXT_FIELDS = ["name", "version"];
const KEPT_EVENT_FIELDS = [
  "event_id",
  "timestamp",
  "platform",
  "level",
  "release",
  "environment",
  "sdk",
];
const KEPT_FRAME_FIELDS = ["filename", "function", "lineno", "colno", "in_app"];
const KEPT_MECHANISM_FIELDS = ["type", "handled"];

const HOME_DIR = /[\\/](?:Users|home)[\\/]/i;
const HOME_PREFIX =
  /^(?:file:\/\/\/?)?(?:[A-Za-z]:)?[\\/](?:Users|home)[\\/][^\\/]+/i;

function isRecord(value: unknown): value is Loose {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick(source: Loose, keys: readonly string[]): Loose {
  const out: Loose = {};
  for (const key of keys) {
    if (key in source && source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

// Page URLs show up as frame files in the browser; their query and fragment
// can hold tokens and personal data.
function stripQuery(path: string): string {
  const cut = path.search(/[?#]/);
  return cut === -1 ? path : path.slice(0, cut);
}

// A page's own address can be a frame file (an inline script), and a page path
// can hold a bearer token such as an invite link. Path segments longer than 16
// characters with no dot are replaced; names with a dot are file names. Build
// output and dependency paths are left alone.
const KEEP_PATH = /[\\/](?:_next|\.next|node_modules)[\\/]/;
const MAX_SEGMENT = 16;

function maskLongSegments(path: string): string {
  if (KEEP_PATH.test(path)) return path;
  return path
    .split("/")
    .map((segment) =>
      segment.length > MAX_SEGMENT && !segment.includes(".") ? ":id" : segment,
    )
    .join("/");
}

function cleanFramePath(path: string): string {
  return maskLongSegments(stripQuery(path));
}

const SAFE_TYPE = /^[A-Za-z0-9_.]{1,80}$/;

function safeType(type: unknown): string {
  return typeof type === "string" && SAFE_TYPE.test(type) ? type : "Error";
}

// The SDK records whether it will infer the visitor IP; make sure it never does.
function scrubSdk(sdk: unknown): unknown {
  if (!isRecord(sdk)) return sdk;
  const out: Loose = { ...sdk };
  if (isRecord(sdk.settings) && "infer_ip" in sdk.settings) {
    out.settings = { ...sdk.settings, infer_ip: "never" };
  }
  return out;
}

function scrubFrame(frame: unknown): unknown {
  if (!isRecord(frame)) return undefined;
  const out = pick(frame, KEPT_FRAME_FIELDS);
  if (typeof out.filename === "string") {
    out.filename = cleanFramePath(out.filename.replace(HOME_PREFIX, "~"));
  }
  const absPath = frame.abs_path;
  if (typeof absPath === "string" && !HOME_DIR.test(absPath)) {
    out.abs_path = cleanFramePath(absPath);
  }
  return out;
}

function scrubException(value: unknown): unknown {
  if (!isRecord(value)) return undefined;
  const out: Loose = { type: safeType(value.type), value: REDACTED_TEXT };
  if (isRecord(value.mechanism)) {
    out.mechanism = pick(value.mechanism, KEPT_MECHANISM_FIELDS);
  }
  const stacktrace = value.stacktrace;
  if (isRecord(stacktrace) && Array.isArray(stacktrace.frames)) {
    out.stacktrace = {
      frames: stacktrace.frames.map(scrubFrame).filter(Boolean),
    };
  }
  return out;
}

function scrubTags(tags: unknown): Loose | undefined {
  if (!isRecord(tags)) return undefined;
  const out = pick(tags, ALLOWED_TAGS);
  return Object.keys(out).length ? out : undefined;
}

function scrubContexts(contexts: unknown): Loose | undefined {
  if (!isRecord(contexts)) return undefined;
  const out: Loose = {};
  for (const name of KEPT_CONTEXTS) {
    const context = contexts[name];
    if (isRecord(context)) out[name] = pick(context, KEPT_CONTEXT_FIELDS);
  }
  return Object.keys(out).length ? out : undefined;
}

/** Rebuilds a Sentry event from an allowlist. Returns a copy; the input is untouched. */
export function scrubSentryEvent<T extends object>(event: T): T {
  const source = event as Loose;
  const out = pick(source, KEPT_EVENT_FIELDS);

  if ("sdk" in out) out.sdk = scrubSdk(out.sdk);
  if ("message" in source) out.message = REDACTED_TEXT;

  const exception = source.exception;
  if (isRecord(exception) && Array.isArray(exception.values)) {
    out.exception = {
      values: exception.values.map(scrubException).filter(Boolean),
    };
  }

  const tags = scrubTags(source.tags);
  if (tags) out.tags = tags;
  const contexts = scrubContexts(source.contexts);
  if (contexts) out.contexts = contexts;
  return out as T;
}

/** Breadcrumbs are switched off: they carry console output and URLs. */
export function dropBreadcrumb(): null {
  return null;
}

/** Performance events are never sent. */
export function dropTransaction(): null {
  return null;
}

/** Keeps only the allowlisted tags from a capture context. */
export function pickAllowedTags(
  context: unknown,
): Record<string, string> | undefined {
  if (!isRecord(context)) return undefined;
  const out: Record<string, string> = {};
  for (const key of ALLOWED_TAGS) {
    const value = context[key];
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      out[key] = String(value).slice(0, 200);
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** Keeps only integrations that report errors. */
export function filterIntegrations<T extends { name: string }>(
  defaults: T[],
): T[] {
  return defaults.filter((integration) =>
    ALLOWED_INTEGRATIONS.has(integration.name),
  );
}

export interface SentryOptionsInput {
  dsn: string;
  release: string;
  environment?: string;
}

/**
 * Init options shared by server and browser. Tracing is off by omission:
 * `tracesSampleRate: 0` still enables tracing in the SDK, so the key is never
 * set, and no trace headers are added to outgoing requests.
 */
export function buildSentryOptions({
  dsn,
  release,
  environment,
}: SentryOptionsInput) {
  return {
    dsn,
    release,
    environment,
    // `sendDefaultPii` does not exist in this SDK; `dataCollection` does. With
    // userInfo off the SDK reports infer_ip "never" instead of "auto".
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [] as never[],
      urlQueryParams: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    maxBreadcrumbs: 0,
    // Spans are never created; "static" also keeps beforeSendTransaction honoured.
    traceLifecycle: "static" as const,
    tracePropagationTargets: [] as string[],
    integrations: filterIntegrations,
    beforeSend: scrubSentryEvent,
    beforeSendTransaction: dropTransaction,
    beforeBreadcrumb: dropBreadcrumb,
  };
}
