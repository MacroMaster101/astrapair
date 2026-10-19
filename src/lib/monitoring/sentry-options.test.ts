import { describe, expect, it } from "vitest";
import {
  buildSentryOptions,
  dropBreadcrumb,
  dropTransaction,
  filterIntegrations,
  pickAllowedTags,
  scrubSentryEvent,
} from "./sentry-options";

type Loose = Record<string, unknown>;

// What the SDK produces for an uncaught exception in a Node server, plus the
// extra fields it attaches.
function autoCapturedEvent(): Loose {
  return {
    event_id: "0123456789abcdef0123456789abcdef",
    timestamp: 1790000000,
    platform: "node",
    level: "fatal",
    release: "rel-1",
    environment: "production",
    server_name: "host-1",
    sdk: { name: "sentry.javascript.nextjs", version: "11.6.0" },
    message: "boom for Priya born 1990-07-15 at 6.93548, 79.84868",
    transaction: "GET /chart/birth-details",
    request: { url: "https://x.test/chart?birth=1990", cookies: { a: "b" } },
    user: { id: "u1", email: "a@b.co", ip_address: "1.2.3.4" },
    extra: { question: "will we last?" },
    modules: { next: "16.3.6" },
    logentry: { message: "free text" },
    fingerprint: ["custom"],
    breadcrumbs: [
      { category: "console", message: "USER ASKED: will I marry Priya" },
    ],
    tags: {
      routePath: "/chart",
      routeType: "render",
      method: "GET",
      digest: "d1g3st",
      email: "a@b.co",
      runtime: "node",
    },
    contexts: {
      runtime: { name: "node", version: "v22.1.0", extra: "x" },
      os: { name: "Windows", version: "11", kernel_version: "10.0.1" },
      device: { arch: "x64", memory_size: 1 },
      app: { app_memory: 1 },
      trace: { trace_id: "abc", span_id: "def" },
      custom: { question: "will we last?" },
    },
    exception: {
      values: [
        {
          type: "TypeError",
          value: "Invalid date or time: 1990-07-15 12:00 for sam@example.com",
          mechanism: {
            type: "auto.node.onuncaughtexception",
            handled: false,
            data: { note: "Priya" },
          },
          stacktrace: {
            frames: [
              {
                filename:
                  "C:\\Users\\Kavisha Lakshan\\app\\.next\\server\\page.js",
                abs_path:
                  "C:\\Users\\Kavisha Lakshan\\app\\.next\\server\\page.js",
                function: "run",
                lineno: 3,
                colno: 7,
                in_app: true,
                vars: { password: "hunter2" },
                context_line: "const secret = 1",
                pre_context: ["a"],
                post_context: ["b"],
                module: "page",
              },
              {
                filename: "app:///_next/static/chunks/main.js",
                abs_path: "https://app.example.com/_next/static/chunks/main.js",
                function: "go",
                lineno: 9,
                colno: 1,
                in_app: false,
              },
            ],
          },
        },
      ],
    },
  };
}

describe("scrubSentryEvent", () => {
  const out = scrubSentryEvent(autoCapturedEvent());

  it("keeps only the allowed top-level fields", () => {
    expect(Object.keys(out).sort()).toEqual(
      [
        "contexts",
        "environment",
        "event_id",
        "exception",
        "level",
        "message",
        "platform",
        "release",
        "sdk",
        "tags",
        "timestamp",
      ].sort(),
    );
    expect(out.release).toBe("rel-1");
    expect(out.environment).toBe("production");
    expect(out.level).toBe("fatal");
    expect(out.platform).toBe("node");
    expect(out.timestamp).toBe(1790000000);
    expect(out.event_id).toBe("0123456789abcdef0123456789abcdef");
  });

  it("replaces the message and every exception value with a fixed string", () => {
    expect(out.message).toBe("[redacted]");
    const values = (out.exception as { values: Loose[] }).values;
    expect(values).toHaveLength(1);
    expect(values[0].type).toBe("TypeError");
    expect(values[0].value).toBe("[redacted]");
    expect(values[0].mechanism).toEqual({
      type: "auto.node.onuncaughtexception",
      handled: false,
    });
  });

  it("reduces stack frames and drops home directory paths", () => {
    const frames = (
      (out.exception as { values: Loose[] }).values[0].stacktrace as {
        frames: Loose[];
      }
    ).frames;
    expect(Object.keys(frames[0]).sort()).toEqual(
      ["colno", "filename", "function", "in_app", "lineno"].sort(),
    );
    expect(frames[0].filename).toBe("~\\app\\.next\\server\\page.js");
    expect(frames[0].abs_path).toBeUndefined();
    expect(frames[1].abs_path).toBe(
      "https://app.example.com/_next/static/chunks/main.js",
    );
    expect(JSON.stringify(frames)).not.toMatch(
      /hunter2|context_line|Kavisha|secret/,
    );
  });

  it("keeps only the allowed tags", () => {
    expect(out.tags).toEqual({
      routePath: "/chart",
      routeType: "render",
      method: "GET",
      digest: "d1g3st",
    });
  });

  it("keeps only runtime and os basics in contexts", () => {
    expect(out.contexts).toEqual({
      runtime: { name: "node", version: "v22.1.0" },
      os: { name: "Windows", version: "11" },
    });
  });

  it("leaks none of the sample personal strings anywhere", () => {
    expect(JSON.stringify(out)).not.toMatch(
      /Priya|1990|6\.93548|sam@example|a@b\.co|u1|1\.2\.3\.4|host-1|will we last|USER ASKED|Kavisha/,
    );
  });

  it("does not mutate its input", () => {
    const event = autoCapturedEvent();
    const before = JSON.stringify(event);
    scrubSentryEvent(event);
    expect(JSON.stringify(event)).toBe(before);
  });

  it("handles an empty event and omits message when there is none", () => {
    expect(scrubSentryEvent({})).toEqual({});
  });
});

describe("scrubSentryEvent extra cases", () => {
  function firstValue(event: Loose): Loose {
    return (scrubSentryEvent(event).exception as { values: Loose[] }).values[0];
  }

  it.each([
    ["TypeError", "TypeError"],
    ["PostgrestError", "PostgrestError"],
    ["My.Custom_Error2", "My.Custom_Error2"],
    ["Priya 1990", "Error"],
    ["a@b.co", "Error"],
    ["Error: boom", "Error"],
    ["", "Error"],
    ["x".repeat(81), "Error"],
    [undefined, "Error"],
    [42, "Error"],
  ])("reduces exception type %j to %j", (type, expected) => {
    expect(
      firstValue({ exception: { values: [{ type, value: "x" }] } }).type,
    ).toBe(expected);
  });

  it("allows an 80 character type", () => {
    const type = "T".repeat(80);
    expect(firstValue({ exception: { values: [{ type }] } }).type).toBe(type);
  });

  it("removes query strings and fragments from frame files", () => {
    const value = firstValue({
      exception: {
        values: [
          {
            type: "Error",
            stacktrace: {
              frames: [
                {
                  filename: "https://app.test/invite/abc?email=a@b.co",
                  abs_path: "https://app.test/chart?birth=1990-07-15#x",
                  lineno: 1,
                },
                { filename: "app:///_next/chunk.js#frag", lineno: 2 },
              ],
            },
          },
        ],
      },
    });
    const frames = (value.stacktrace as { frames: Loose[] }).frames;
    expect(frames[0].filename).toBe("https://app.test/invite/abc");
    expect(frames[0].abs_path).toBe("https://app.test/chart");
    expect(frames[1].filename).toBe("app:///_next/chunk.js");
    expect(JSON.stringify(frames)).not.toMatch(/a@b|1990|birth|#|\?/);
  });

  it("masks long path segments, such as an invite token, in frame files", () => {
    const token = "Zk3mQ9xT1vB7nW4yL8cR2dF6hJ0aS5uE_gP-iOtKXyz"; // 43 characters
    expect(token).toHaveLength(43);
    const value = firstValue({
      exception: {
        values: [
          {
            type: "Error",
            stacktrace: {
              frames: [
                {
                  filename: `https://app.test/invite/${token}?x=1`,
                  abs_path: `https://app.test/invite/${token}#frag`,
                  lineno: 1,
                },
                { filename: `/invite/${token}`, lineno: 2 },
                {
                  filename:
                    "app:///_next/static/chunks/some-long-chunk-name-1234.js",
                  lineno: 3,
                },
                {
                  filename: "https://app.test/chart/birth-details-form.js",
                  lineno: 4,
                },
              ],
            },
          },
        ],
      },
    });
    const frames = (value.stacktrace as { frames: Loose[] }).frames;
    expect(frames[0].filename).toBe("https://app.test/invite/:id");
    expect(frames[0].abs_path).toBe("https://app.test/invite/:id");
    expect(frames[1].filename).toBe("/invite/:id");
    // Build output keeps its chunk names, and file names (with a dot) stay.
    expect(frames[2].filename).toBe(
      "app:///_next/static/chunks/some-long-chunk-name-1234.js",
    );
    expect(frames[3].filename).toBe(
      "https://app.test/chart/birth-details-form.js",
    );
    expect(JSON.stringify(frames)).not.toContain(token);
  });

  it("forces sdk.settings.infer_ip to never when present", () => {
    const out = scrubSentryEvent({
      sdk: {
        name: "sentry.javascript.nextjs",
        settings: { infer_ip: "auto", other: 1 },
      },
    }) as { sdk: { name: string; settings: Loose } };
    expect(out.sdk.settings.infer_ip).toBe("never");
    expect(out.sdk.settings.other).toBe(1);
    expect(out.sdk.name).toBe("sentry.javascript.nextjs");
  });

  it("does not add settings to an sdk that has none", () => {
    const out = scrubSentryEvent({ sdk: { name: "x" } }) as { sdk: Loose };
    expect(out.sdk).toEqual({ name: "x" });
  });
});

describe("hooks", () => {
  it("drops breadcrumbs and transactions", () => {
    expect(dropBreadcrumb()).toBeNull();
    expect(dropTransaction()).toBeNull();
  });
});

describe("pickAllowedTags", () => {
  it("passes only the allowlisted keys, as strings", () => {
    expect(
      pickAllowedTags({
        routePath: "/chart",
        method: "GET",
        attempt: 2,
        email: "a@b.co",
        digest: 5,
      }),
    ).toEqual({ routePath: "/chart", method: "GET", digest: "5" });
  });

  it("returns undefined when nothing is allowed", () => {
    expect(pickAllowedTags({ email: "a@b.co" })).toBeUndefined();
    expect(pickAllowedTags(undefined)).toBeUndefined();
    expect(pickAllowedTags("x")).toBeUndefined();
  });
});

describe("filterIntegrations", () => {
  it("keeps error capture and drops console, http, context lines and tracing", () => {
    const names = [
      "EventFilters",
      "FunctionToString",
      "LinkedErrors",
      "Dedupe",
      "OnUncaughtException",
      "OnUnhandledRejection",
      "GlobalHandlers",
      "Console",
      "NodeFetch",
      "Http",
      "ContextLines",
      "LocalVariablesAsync",
      "Modules",
      "RequestData",
      "Breadcrumbs",
      "BrowserTracing",
      "Express",
      "Postgres",
    ].map((name) => ({ name }));
    expect(filterIntegrations(names).map((i) => i.name)).toEqual([
      "EventFilters",
      "FunctionToString",
      "LinkedErrors",
      "Dedupe",
      "OnUncaughtException",
      "OnUnhandledRejection",
      "GlobalHandlers",
    ]);
  });
});

describe("buildSentryOptions", () => {
  const options = buildSentryOptions({
    dsn: "https://k@o1.ingest.sentry.io/1",
    release: "r1",
    environment: "production",
  });

  it("carries the DSN, release and environment", () => {
    expect(options.dsn).toBe("https://k@o1.ingest.sentry.io/1");
    expect(options.release).toBe("r1");
    expect(options.environment).toBe("production");
  });

  it("sends no PII and keeps no breadcrumbs", () => {
    expect("sendDefaultPii" in options).toBe(false);
    expect(options.dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    });
    expect(options.maxBreadcrumbs).toBe(0);
    expect(options.beforeBreadcrumb).toBe(dropBreadcrumb);
  });

  it("has tracing off: no tracesSampleRate key and no propagation targets", () => {
    expect("tracesSampleRate" in options).toBe(false);
    expect("tracesSampler" in options).toBe(false);
    expect(options.tracePropagationTargets).toEqual([]);
    expect(options.beforeSendTransaction).toBe(dropTransaction);
  });

  it("scrubs every event and limits integrations", () => {
    expect(options.beforeSend).toBe(scrubSentryEvent);
    expect(options.integrations).toBe(filterIntegrations);
  });
});
