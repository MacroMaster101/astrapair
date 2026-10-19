import { describe, expect, it } from "vitest";
import { buildCsp, generateNonce } from "./csp";

const SUPABASE = "https://abc.supabase.co";
const NONCE = "bm9uY2U=";

function directives(csp: string) {
  const map = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) map.set(name, values);
  }
  return map;
}

const prod = (extra: Partial<Parameters<typeof buildCsp>[0]> = {}) =>
  directives(
    buildCsp({
      nonce: NONCE,
      isDev: false,
      isHttps: true,
      supabaseUrl: SUPABASE,
      ...extra,
    }),
  );
const dev = (extra: Partial<Parameters<typeof buildCsp>[0]> = {}) =>
  directives(
    buildCsp({
      nonce: NONCE,
      isDev: true,
      isHttps: false,
      supabaseUrl: SUPABASE,
      ...extra,
    }),
  );

describe("buildCsp", () => {
  it("sets every expected directive", () => {
    const names = [...prod().keys()];
    expect(names).toEqual(
      expect.arrayContaining([
        "default-src",
        "script-src",
        "style-src",
        "img-src",
        "font-src",
        "connect-src",
        "frame-ancestors",
        "base-uri",
        "form-action",
        "object-src",
        "upgrade-insecure-requests",
      ]),
    );
    expect(prod().get("default-src")).toEqual(["'self'"]);
    expect(prod().get("font-src")).toEqual(["'self'"]);
    expect(prod().get("img-src")).toEqual(["'self'", "blob:", "data:"]);
    expect(prod().get("object-src")).toEqual(["'none'"]);
    expect(prod().get("base-uri")).toEqual(["'self'"]);
  });

  it("puts the nonce and strict-dynamic in script-src", () => {
    expect(prod().get("script-src")).toEqual([
      "'self'",
      `'nonce-${NONCE}'`,
      "'strict-dynamic'",
    ]);
  });

  it("never allows inline scripts or wildcards in script-src", () => {
    for (const map of [prod(), dev()]) {
      const scriptSrc = map.get("script-src") ?? [];
      expect(scriptSrc).not.toContain("'unsafe-inline'");
      expect(scriptSrc).not.toContain("*");
    }
  });

  it("allows unsafe-eval only in development", () => {
    expect(dev().get("script-src")).toContain("'unsafe-eval'");
    expect(prod().get("script-src")).not.toContain("'unsafe-eval'");
  });

  it("upgrades insecure requests only when the request is https", () => {
    expect(prod().has("upgrade-insecure-requests")).toBe(true);
    expect(dev().has("upgrade-insecure-requests")).toBe(false);
    // A production build served over plain http (local `pnpm start`).
    expect(prod({ isHttps: false }).has("upgrade-insecure-requests")).toBe(
      false,
    );
    // Development behind https still does not need it.
    expect(dev({ isHttps: true }).has("upgrade-insecure-requests")).toBe(true);
  });

  it("allows inline style attributes", () => {
    expect(prod().get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it("refuses framing", () => {
    expect(prod().get("frame-ancestors")).toEqual(["'none'"]);
  });

  it("never uses a bare wildcard source", () => {
    const csp = buildCsp({
      nonce: NONCE,
      isDev: false,
      isHttps: true,
      supabaseUrl: SUPABASE,
      sentryDsn: "https://key@o1.ingest.sentry.io/2",
    });
    expect(csp.split(/[\s;]+/)).not.toContain("*");
  });

  describe("connect-src", () => {
    it("allows self plus Supabase over https and wss", () => {
      expect(prod().get("connect-src")).toEqual([
        "'self'",
        SUPABASE,
        "wss://abc.supabase.co",
      ]);
    });

    it("uses ws for a plain http Supabase (local stack)", () => {
      const map = prod({ supabaseUrl: "http://127.0.0.1:54321" });
      expect(map.get("connect-src")).toEqual([
        "'self'",
        "http://127.0.0.1:54321",
        "ws://127.0.0.1:54321",
      ]);
    });

    it("adds the Sentry ingest origin only when a DSN is given", () => {
      const dsn = "https://publickey@o123.ingest.sentry.io/456";
      expect(prod({ sentryDsn: dsn }).get("connect-src")).toContain(
        "https://o123.ingest.sentry.io",
      );
      expect(prod().get("connect-src")?.join(" ")).not.toContain("sentry");
      expect(
        prod({ sentryDsn: "" }).get("connect-src")?.join(" "),
      ).not.toContain("sentry");
      expect(
        prod({ sentryDsn: null }).get("connect-src")?.join(" "),
      ).not.toContain("sentry");
    });

    it("does not leak the DSN key or project path", () => {
      const csp = buildCsp({
        nonce: NONCE,
        isDev: false,
        isHttps: true,
        supabaseUrl: SUPABASE,
        sentryDsn: "https://publickey@o123.ingest.sentry.io/456",
      });
      expect(csp).not.toContain("publickey");
      expect(csp).not.toContain("/456");
    });

    it("allows localhost websockets for HMR only in development", () => {
      expect(dev().get("connect-src")).toEqual(
        expect.arrayContaining([
          "ws://localhost:*",
          "wss://localhost:*",
          "ws://127.0.0.1:*",
          "wss://127.0.0.1:*",
        ]),
      );
      expect(prod().get("connect-src")?.join(" ")).not.toContain("localhost");
    });
  });

  describe("form-action", () => {
    it("allows self, Supabase and Google for the OAuth redirect chain", () => {
      expect(prod().get("form-action")).toEqual([
        "'self'",
        SUPABASE,
        "https://accounts.google.com",
      ]);
    });
  });

  describe("bad input", () => {
    it("does not throw on a malformed Supabase URL and leaves it out", () => {
      for (const supabaseUrl of ["not a url", "", null, "ftp://x.test"]) {
        expect(() =>
          buildCsp({ nonce: NONCE, isDev: false, isHttps: true, supabaseUrl }),
        ).not.toThrow();
        const map = prod({ supabaseUrl });
        expect(map.get("connect-src")).toEqual(["'self'"]);
        expect(map.get("form-action")).toEqual([
          "'self'",
          "https://accounts.google.com",
        ]);
      }
    });

    it("does not throw on a malformed Sentry DSN and ignores it", () => {
      for (const sentryDsn of ["nope", "://", "javascript:alert(1)", "   "]) {
        expect(() =>
          buildCsp({
            nonce: NONCE,
            isDev: false,
            isHttps: true,
            supabaseUrl: SUPABASE,
            sentryDsn,
          }),
        ).not.toThrow();
        expect(prod({ sentryDsn }).get("connect-src")).toEqual([
          "'self'",
          SUPABASE,
          "wss://abc.supabase.co",
        ]);
      }
    });

    // Each value parses as a URL, so the old "contains a space" case proved
    // nothing: these are the shapes that really reach the header.
    const hostile = [
      "https://a.test;frame-ancestors",
      "https://a.test;frame-ancestors *",
      "https://a.test,b.test",
      "https://a.test'unsafe-inline'",
      "https://*.evil.test",
      "https://user:pass@a.test",
      "https://a.test\nframe-ancestors *",
      "https://a.test\r\nX-Injected: 1",
      "https://[::1]",
      "https://a.test:99a",
      "https://-a.test",
    ];

    function expectIntact(csp: string) {
      expect(csp).not.toMatch(/[\r\n,]/);
      expect(csp.match(/frame-ancestors/g)).toHaveLength(1);
      expect(csp.match(/frame-ancestors 'none'/g)).toHaveLength(1);
      expect(csp.match(/script-src/g)).toHaveLength(1);
      expect(csp.match(/object-src 'none'/g)).toHaveLength(1);
      // The one legitimate 'unsafe-inline' is the style-src one.
      expect(csp.match(/unsafe-inline/g)).toHaveLength(1);
      for (const text of ["evil", "injected", "user", "pass"]) {
        expect(csp.toLowerCase()).not.toContain(text.toLowerCase());
      }
      expect(csp.split(/[\s;]+/)).not.toContain("*");
    }

    it.each(hostile)("drops a hostile Supabase URL: %j", (supabaseUrl) => {
      const csp = buildCsp({
        nonce: NONCE,
        isDev: false,
        isHttps: true,
        supabaseUrl,
      });
      expectIntact(csp);
      const map = directives(csp);
      expect(map.get("connect-src")).toEqual(["'self'"]);
      expect(map.get("form-action")).toEqual([
        "'self'",
        "https://accounts.google.com",
      ]);
    });

    it.each(hostile.filter((value) => !value.includes("user:pass")))(
      "drops a hostile Sentry DSN: %j",
      (sentryDsn) => {
        const csp = buildCsp({
          nonce: NONCE,
          isDev: false,
          isHttps: true,
          supabaseUrl: SUPABASE,
          sentryDsn,
        });
        expectIntact(csp);
        expect(directives(csp).get("connect-src")).toEqual([
          "'self'",
          SUPABASE,
          "wss://abc.supabase.co",
        ]);
      },
    );

    it("rebuilds the origin from validated parts (no path, query or userinfo)", () => {
      const map = prod({
        supabaseUrl: "https://abc.supabase.co:8443/rest/v1?x=1#y",
        sentryDsn: "https://key@o1.ingest.sentry.io:443/123",
      });
      expect(map.get("connect-src")).toEqual([
        "'self'",
        "https://abc.supabase.co:8443",
        "wss://abc.supabase.co:8443",
        "https://o1.ingest.sentry.io",
      ]);
    });
  });
});

describe("generateNonce", () => {
  it("is 16 random bytes in base64", () => {
    const nonce = generateNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(atob(nonce)).toHaveLength(16);
  });

  it("differs on every call", () => {
    const nonces = new Set(Array.from({ length: 50 }, generateNonce));
    expect(nonces.size).toBe(50);
  });
});
