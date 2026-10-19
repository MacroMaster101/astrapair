import { describe, expect, it } from "vitest";
import { redactError, redactString, redactValue } from "./redact";

const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

describe("redactString", () => {
  it("masks email addresses", () => {
    const out = redactString("no row for sam.lee+test@example.co.uk found");
    expect(out).not.toContain("sam.lee");
    expect(out).not.toContain("example.co.uk");
    expect(out).toContain("no row for");
    expect(out).toContain("found");
  });

  it("masks JWT-shaped strings", () => {
    const out = redactString(`invalid token ${JWT} rejected`);
    expect(out).not.toContain("eyJ");
    expect(out).not.toContain("dozjgNry");
    expect(out).toContain("invalid token");
    expect(out).toContain("rejected");
  });

  it("masks bearer values", () => {
    const out = redactString("header was Bearer abc.def-ghi_jkl so rejected");
    expect(out).not.toContain("abc.def");
    expect(out).toContain("so rejected");
  });

  it("masks 40-character hex strings", () => {
    const hex = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
    expect(hex).toHaveLength(40);
    expect(redactString(`commit ${hex} failed`)).not.toContain("a1b2c3d4");
  });

  it("masks runs of 24 or more token characters but keeps short words", () => {
    const out = redactString("key AbCdEfGhIjKlMnOpQrStUvWx_-1 on route /chart");
    expect(out).not.toContain("AbCdEfGh");
    expect(out).toContain("/chart");
    expect(redactString("short_token_value ok")).toBe("short_token_value ok");
  });

  it("keeps long identifiers made only of words", () => {
    const msg =
      'violates unique constraint "birth_profiles_user_id_key" in createServerClientForRequest';
    expect(redactString(msg)).toBe(msg);
  });

  it("masks postgres connection strings with passwords", () => {
    const out = redactString(
      "connect failed postgres://postgres:hunter2@db.example.supabase.co:5432/postgres",
    );
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("postgres:hunter2");
    expect(out).toContain("connect failed");
  });

  it("masks credentials embedded in https URLs", () => {
    const out = redactString("GET https://user:pa55w0rd@host.example.com/x");
    expect(out).not.toContain("pa55w0rd");
    expect(out).not.toContain("user:");
    expect(out).toContain("host.example.com/x");
  });

  it("leaves ordinary messages alone", () => {
    const msg = "Cannot read properties of undefined (reading 'planets')";
    expect(redactString(msg)).toBe(msg);
  });

  it("caps string length at 500 characters", () => {
    const out = redactString("word ".repeat(400));
    expect(out.length).toBeLessThanOrEqual(520);
    expect(out).toContain("[truncated]");
  });
});

describe("redactValue", () => {
  it("replaces sensitive keys entirely, case-insensitively", () => {
    const out = redactValue({
      Password: "x",
      accessToken: "y",
      client_secret: "z",
      Authorization: "Bearer q",
      cookie: "c",
      apiKey: "k",
      api_key: "k",
      Email: "a@b.co",
      session_id: "s",
      jwt: "j",
      dsn: "https://k@o.ingest.sentry.io/1",
      note: "kept",
    }) as Record<string, unknown>;
    for (const key of Object.keys(out)) {
      if (key === "note") continue;
      expect(out[key], key).toBe("[redacted]");
    }
    expect(out.note).toBe("kept");
  });

  it("replaces birth and chart related keys", () => {
    const out = redactValue({
      birth_date: "1990-01-02",
      birthTime: "10:00",
      birth_place: "Paris",
      latitude: 1,
      longitude: 2,
      timezone: "Europe/Paris",
      place_name: "Paris",
      question: "will we last?",
      answer: "yes",
      content: "text",
      facts: { a: 1 },
      interpretation: "x",
      body: "payload",
      route: "/chart",
    }) as Record<string, unknown>;
    expect(out.route).toBe("/chart");
    expect(Object.keys(out).filter((k) => out[k] !== "[redacted]")).toEqual([
      "route",
    ]);
  });

  it("recurses into nested objects and arrays", () => {
    const out = redactValue({
      a: { b: [{ email: "x@y.zz", ok: "fine" }] },
      list: ["mail me at x@y.zz", 3, true, null],
    }) as {
      a: { b: { email: string; ok: string }[] };
      list: unknown[];
    };
    expect(out.a.b[0]).toEqual({ email: "[redacted]", ok: "fine" });
    expect(out.list[0]).not.toContain("x@y.zz");
    expect(out.list.slice(1)).toEqual([3, true, null]);
  });

  it("passes through non-string primitives and handles undefined", () => {
    expect(redactValue(5)).toBe(5);
    expect(redactValue(false)).toBe(false);
    expect(redactValue(null)).toBeNull();
    expect(redactValue(undefined)).toBeUndefined();
    expect(redactValue(BigInt(10))).toBe("10");
    expect(redactValue(() => 1)).toBe("[function]");
    expect(redactValue(Symbol("s"))).toBe("[symbol]");
  });

  it("survives cycles", () => {
    const a: Record<string, unknown> = { label: "a" };
    a.self = a;
    const out = redactValue(a) as Record<string, unknown>;
    expect(out.label).toBe("a");
    expect(out.self).toBe("[circular]");
  });

  it("does not call a shared (non-circular) reference circular", () => {
    const shared = { ok: "yes" };
    const out = redactValue({ a: shared, b: shared }) as Record<
      string,
      unknown
    >;
    expect(out.a).toEqual({ ok: "yes" });
    expect(out.b).toEqual({ ok: "yes" });
  });

  it("limits depth to 6", () => {
    let deep: Record<string, unknown> = { leaf: "x" };
    for (let i = 0; i < 10; i++) deep = { child: deep };
    const text = JSON.stringify(redactValue(deep));
    expect(text).toContain("[max depth]");
    expect(text).not.toContain("leaf");
  });

  it("caps arrays at 20 items", () => {
    const out = redactValue(
      Array.from({ length: 50 }, (_, i) => i),
    ) as unknown[];
    expect(out).toHaveLength(21);
    expect(out[20]).toBe("[30 more items]");
  });

  it("caps long strings", () => {
    const out = redactValue({ note: "a b ".repeat(400) }) as { note: string };
    expect(out.note.length).toBeLessThanOrEqual(520);
  });

  it("redacts Date and Error values", () => {
    const out = redactValue({
      when: new Date("2026-01-02T03:04:05.000Z"),
      err: new Error("bad for a@b.co"),
    }) as { when: string; err: { name: string; message: string } };
    expect(out.when).toBe("2026-01-02T03:04:05.000Z");
    expect(out.err.name).toBe("Error");
    expect(out.err.message).not.toContain("a@b.co");
  });

  it("does not throw on objects with throwing getters", () => {
    const evil = {
      get boom(): string {
        throw new Error("nope");
      },
    };
    expect(() => redactValue(evil)).not.toThrow();
  });
});

describe("redactError", () => {
  it("keeps the name and a redacted message", () => {
    const err = new TypeError("Cannot read x for sam@example.com");
    const out = redactError(err);
    expect(out.name).toBe("TypeError");
    expect(out.message).toContain("Cannot read x for");
    expect(out.message).not.toContain("sam@example.com");
    expect(out.stack).toContain("TypeError");
    expect(out.stack).not.toContain("sam@example.com");
  });

  it("redacts secrets inside the stack", () => {
    const err = new Error(`boom ${JWT}`);
    expect(redactError(err).stack).not.toContain("dozjgNry");
  });

  it("handles non-Error throwables", () => {
    expect(redactError("plain failure for a@b.co")).toEqual({
      name: "NonError",
      message: "plain failure for [email]",
    });
    expect(redactError(42).message).toBe("42");
    expect(redactError(null).name).toBe("NonError");
    expect(redactError(undefined).message).toBe("undefined");
  });

  it("describes plain object throwables without leaking sensitive fields", () => {
    const out = redactError({
      message: "nope",
      email: "a@b.co",
      token: "t",
    });
    expect(out.message).toBe("nope");
    expect(JSON.stringify(out)).not.toContain("a@b.co");
  });

  it("redacts a realistic Supabase error object", () => {
    const supabaseError = {
      message:
        'duplicate key value violates unique constraint "birth_profiles_user_id_key"',
      details:
        "Key (user_id)=(3f1f2c1e-9d6a-4c0b-8a3e-5b7c2d9e1f40) already exists. Contact sam@example.com",
      hint: null,
      code: "23505",
      name: "PostgrestError",
    };
    const out = redactError(supabaseError);
    expect(out.name).toBe("PostgrestError");
    expect(out.message).toContain("duplicate key value");
    expect(out.message).toContain("birth_profiles_user_id_key");
    expect(JSON.stringify(out)).not.toContain("sam@example.com");
    expect(JSON.stringify(out)).not.toContain(
      "3f1f2c1e-9d6a-4c0b-8a3e-5b7c2d9e1f40",
    );
  });

  it("keeps row UUIDs in a Supabase error but masks the email beside them", () => {
    const err = new Error(
      "No rows for id 3f1f2c1e-9d6a-4c0b-8a3e-5b7c2d9e1f40 (jane@example.com)",
    );
    err.name = "PostgrestError";
    const out = redactError(err);
    expect(out.name).toBe("PostgrestError");
    expect(out.message).toContain("No rows for id");
    expect(out.message).toContain("3f1f2c1e-9d6a-4c0b-8a3e-5b7c2d9e1f40");
    expect(out.message).not.toContain("jane@");
  });

  it("handles an error whose message getter throws", () => {
    const err = new Error("x");
    Object.defineProperty(err, "message", {
      get() {
        throw new Error("nope");
      },
    });
    expect(() => redactError(err)).not.toThrow();
  });

  it("truncates stacks to a sane size", () => {
    const err = new Error("x");
    err.stack = "Error: x\n" + "    at fn (file.js:1:1)\n".repeat(500);
    expect(redactError(err).stack!.length).toBeLessThanOrEqual(2020);
  });
});

describe("structural masks (birth details and query strings)", () => {
  const masked: [string, string[]][] = [
    ["born 1990-07-15 in town", ["1990-07-15"]],
    ["Invalid date or time: 1990-07-15 12:00", ["1990-07-15", "12:00"]],
    ["dob was 15/07/1990 ok", ["15/07/1990"]],
    ["on 1990/07/15 ok", ["1990/07/15"]],
    ["at 12:00 sharp", ["12:00"]],
    ["at 9:05:33 sharp", ["9:05:33"]],
    ["1990-07-15T12:00:00 end", ["1990-07-15", "12:00:00"]],
    ["coords 6.93548, 79.84868 here", ["6.93548", "79.84868"]],
    ["lat 6.93548 lng 79.84868", ["6.93548", "79.84868"]],
    ["pair 6.93,79.84 here", ["6.93", "79.84"]],
    ["offset -33.86882 only", ["-33.86882"]],
    [
      "fetch failed for https://api.example.com/chart?token=abc123&email=a@b.co&birth=1990-07-15",
      ["abc123", "a@b.co", "birth=", "1990"],
    ],
    ["/chart?place=Colombo&lat=6.93548&lng=79.84868", ["Colombo", "6.93548"]],
    ["password=hunter2 api_key=abcd1234", ["hunter2", "abcd1234"]],
    ["token=short", ["short"]],
    ["place=Colombo", ["Colombo"]],
    ['session_id="abc def"', ["abc def"]],
  ];

  it.each(masked)("masks %s", (input, gone) => {
    const out = redactString(input);
    for (const part of gone) expect(out, out).not.toContain(part);
  });

  it("replaces a query string with a marker and keeps the path", () => {
    expect(redactString("GET /chart?birth=1990-07-15&x=1 failed")).toBe(
      "GET /chart?[redacted] failed",
    );
    expect(redactString("see https://x.test/a?b=c")).toBe(
      "see https://x.test/a?[redacted]",
    );
  });

  it("keeps key names when masking key=value pairs", () => {
    expect(redactString("password=hunter2 ok")).toBe("password=[redacted] ok");
  });

  const kept = [
    'duplicate key value violates unique constraint "birth_profiles_owner_user_id_key"',
    'violates foreign key constraint "partner_links_inviter_birth_profile_id_fkey"',
    "function accept_partner_invite_with_token failed",
    "createServerClientForRequest threw",
    "Key (owner_user_id)=(3f1f2c1e-9d6a-4c0b-8a3e-5b7c2d9e1f40) already exists",
    "3f1f2c1e-9d6a-4c0b-8a3e-5b7c2d9e1f40",
    "SQLSTATE 23505 raised",
    "code 42501",
    "at /(app)/partner/report page",
    "route /legal/[slug] failed",
    "route /forgot-password failed",
    "Will I marry Priya next year? My mother says no",
    "Cannot read properties of undefined (reading 'planets')",
    "at run (C:/app/.next/server/chunks/page.js:123:45)",
    "node 20.19.43 on build 0.1.0",
    "birth_profiles_2026_key_something_long_enough",
    "platform=linux template=base",
  ];

  it.each(kept)("keeps %s", (input) => {
    expect(redactString(input)).toBe(input);
  });

  it("still masks random base64url tokens made of letters and separators", () => {
    const token = "Qx-Lm_Zk-Pw_Rt-Yb_Nc-Vd_Hs-Jf_Gq-Wa_Ue-Io_Tp";
    expect(redactString(`invite ${token}`)).not.toContain("Qx-Lm");
  });

  it("does not exempt very long word chains", () => {
    const long = Array.from({ length: 20 }, () => "word").join("_");
    expect(redactString(long)).toBe("[token]");
  });
});

describe("redactValue keys", () => {
  it("masks sensitive-looking object keys and caps the key count", () => {
    const wide: Record<string, number> = {};
    for (let i = 0; i < 30; i++) wide[`k${i}x`] = i;
    const out = redactValue({
      "sam@example.com": "v",
      ...wide,
    }) as Record<string, unknown>;
    expect(Object.keys(out)).not.toContain("sam@example.com");
    expect(Object.keys(out).length).toBeLessThanOrEqual(22);
    expect(out["[more keys]"]).toBeGreaterThan(0);
  });

  it("treats generic person and coordinate names as sensitive", () => {
    const out = redactValue({
      lat: 1,
      lng: 2,
      dob: "x",
      display_name: "Sam",
      name: "Sam",
      prompt: "p",
      platform: "linux",
    }) as Record<string, unknown>;
    expect(out.platform).toBe("linux");
    for (const k of ["lat", "lng", "dob", "display_name", "name", "prompt"]) {
      expect(out[k], k).toBe("[redacted]");
    }
  });
});

describe("linear time on adversarial input", () => {
  const repeat = (unit: string, times: number) => unit.repeat(times);
  const cases: [string, string][] = [
    // The reviewer's slow inputs.
    ["key x3300", repeat("key", 3300)],
    ["api_key x1400", repeat("api_key", 1400)],
    ["a-key- x1600", repeat("a-key-", 1600)],
    ["token_ x1600", repeat("token_", 1600)],
    ["monkey- x1400", repeat("monkey-", 1400)],
    ["session-id- x900", repeat("session-id-", 900)],
    ["a x9999", repeat("a", 9999)],
    // Every keyword on its own, joined and unjoined.
    ...[
      "password",
      "token",
      "secret",
      "authorization",
      "cookie",
      "apikey",
      "email",
      "birth",
      "latitude",
      "place",
      "question",
      "content",
      "session",
      "dsn",
    ].flatMap((word): [string, string][] => [
      [`${word} joined`, repeat(word, Math.floor(10_000 / word.length))],
      [
        `${word}- dashed`,
        repeat(`${word}-`, Math.floor(10_000 / (word.length + 1))),
      ],
      [
        `${word}= pairs`,
        repeat(`${word}=`, Math.floor(10_000 / (word.length + 1))),
      ],
    ]),
    // Other shapes the patterns look for.
    ["digits", repeat("1", 10_000)],
    ["digit dots", repeat("1.", 5000)],
    ["digit dot digits", repeat("1.234 ", 1700)],
    ["decimal pairs", repeat("1.5,", 2500)],
    ["times", repeat("1:23", 2500)],
    ["times spaced", repeat("1:23 ", 2000)],
    ["dates", repeat("2020-01-02-", 900)],
    ["slash dates", repeat("1/2/", 2500)],
    ["dots", repeat(".", 10_000)],
    ["hyphens", repeat("-", 10_000)],
    ["underscores", repeat("_", 10_000)],
    ["at signs", repeat("@", 10_000)],
    ["a at", repeat("a@", 5000)],
    ["local part then at", repeat("a.", 4000) + "@" + repeat("b.", 1000)],
    ["domain labels", "a@" + repeat("b.", 5000)],
    ["question marks", repeat("?", 10_000)],
    ["a question", repeat("a?", 5000)],
    ["equals", repeat("=", 10_000)],
    ["a equals", repeat("a=", 5000)],
    ["quoted values", repeat("a='", 3000)],
    ["double quoted values", repeat('a="', 3000)],
    ["eyJ", repeat("eyJ", 3300)],
    ["eyJ dotted", repeat("eyJ.", 2500)],
    ["Bearer", repeat("Bearer ", 1400)],
    ["Bearer spaces", "Bearer" + repeat(" ", 9990)],
    ["http", repeat("http://", 1400)],
    ["http userinfo", repeat("http://a:", 1100)],
    ["postgres", repeat("postgres://", 900)],
    ["long mixed tokens", repeat("Ab1_-", 2000)],
    ["word chain", repeat("word_", 2000)],
    ["camel", repeat("aBc", 3300)],
    ["spaces", repeat(" ", 10_000)],
  ];

  it.each(cases)("redactString finishes quickly: %s", (_name, input) => {
    const started = performance.now();
    redactString(input);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("redactError and redactValue finish quickly on a long stack and message", () => {
    const err = new Error(repeat("key=", 2500));
    err.stack = repeat("    at fn (file.js:12:34) key-token_", 400);
    const started = performance.now();
    redactError(err);
    redactValue({ a: repeat("api_key", 1400), b: [repeat("token_", 1600)] });
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe("redaction details from review round 1", () => {
  it("masks the date and time of an ISO timestamp", () => {
    expect(redactString("at 2026-10-10T12:34:56.789Z done")).toBe(
      "at [date]T[time]Z done",
    );
  });

  it("keeps camelCase identifiers that contain a short number", () => {
    const name = "getUserProfileV2ForRequestHandler";
    expect(redactString(`calling ${name} now`)).toBe(`calling ${name} now`);
  });

  it("masks JWTs with and without a trailing full stop", () => {
    expect(redactString(`bad ${JWT}.`)).toBe("bad [jwt].");
    expect(redactString("eyJhbGciOiJ is not a JWT")).toBe(
      "eyJhbGciOiJ is not a JWT",
    );
  });

  it("only masks key=value pairs for sensitive keys", () => {
    expect(redactString("mode=fast session=abc lat=6.9")).toBe(
      "mode=fast session=[redacted] lat=[redacted]",
    );
    expect(redactString("a.b-password=x")).toBe("a.b-password=[redacted]");
  });

  it("summarises typed arrays instead of listing bytes", () => {
    expect(redactValue({ data: new Uint8Array([1, 2, 3]) })).toEqual({
      data: "[binary]",
    });
    expect(redactValue(new ArrayBuffer(4))).toBe("[binary]");
  });
});
