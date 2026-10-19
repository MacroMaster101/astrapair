import { describe, expect, it } from "vitest";
import { DEFAULT_OPENAI_BASE_URL, parseOpenAiBaseUrl } from "./openai-base-url";

describe("parseOpenAiBaseUrl", () => {
  it("defaults when unset or blank", () => {
    expect(DEFAULT_OPENAI_BASE_URL).toBe("https://api.openai.com");
    for (const v of [undefined, "", "   "])
      expect(parseOpenAiBaseUrl(v)).toBe("https://api.openai.com");
  });

  it("drops a trailing slash and a trailing /v1, because the provider adds /v1", () => {
    const cases: [string, string][] = [
      ["https://api.openai.com/", "https://api.openai.com"],
      ["https://api.openai.com/v1", "https://api.openai.com"],
      ["https://api.openai.com/v1/", "https://api.openai.com"],
      ["https://api.openai.com//", "https://api.openai.com"],
      [
        "https://proxy.example.com/openai/v1",
        "https://proxy.example.com/openai",
      ],
      ["https://proxy.example.com/openai/", "https://proxy.example.com/openai"],
      ["http://localhost:8080/v1/", "http://localhost:8080"],
    ];
    for (const [input, expected] of cases)
      expect(parseOpenAiBaseUrl(input)).toBe(expected);
  });

  it("rejects a query string or fragment, which would swallow the request path", () => {
    for (const v of [
      "https://api.openai.com?x=1",
      "https://api.openai.com/?x=1",
      "https://api.openai.com#frag",
      "https://api.openai.com/v1#",
      "https://api.openai.com/v1?",
    ])
      expect(parseOpenAiBaseUrl(v)).toBeNull();
  });

  it("allows http only for local hosts, in any spelling the URL parser maps to them", () => {
    expect(parseOpenAiBaseUrl("HTTP://LOCALHOST:8080")).toBe(
      "http://localhost:8080",
    );
    expect(parseOpenAiBaseUrl("http://[0:0:0:0:0:0:0:1]:8080")).toBe(
      "http://[::1]:8080",
    );
    expect(parseOpenAiBaseUrl("http://127.0.0.1")).toBe("http://127.0.0.1");
  });

  it("rejects non-local http, odd schemes, credentials and look-alike hosts", () => {
    for (const v of [
      "http://api.openai.com",
      "http://localhost.evil.com",
      "http://localhost.:8080",
      "http://localhost@evil.com",
      "http://localhost:80@evil.com",
      "http://@evil.com",
      // A real backslash: the parser reads it as a slash, so the host is evil.com.
      "http://evil.com\\@localhost",
      "http://localhost%2eevil.com",
      "http://[::ffff:127.0.0.1]",
      "ftp://localhost",
      "javascript:alert(1)",
      "not a url",
      "api.openai.com",
      "https://user:pass@api.openai.com",
    ])
      expect(parseOpenAiBaseUrl(v), v).toBeNull();
  });

  it("keeps the host that was checked when the input has a backslash", () => {
    // The URL parser reads the backslash as a slash, so "@evil.com" is a path
    // on localhost, not a host. The result must say exactly that.
    const result = parseOpenAiBaseUrl("http://localhost\\@evil.com");
    expect(result).toBe("http://localhost/@evil.com");
    expect(new URL(result!).hostname).toBe("localhost");
    // And the other way round: the host is evil.com, which http does not allow.
    expect(parseOpenAiBaseUrl("http://evil.com\\@localhost")).toBeNull();
    // https is allowed for any host, and the result still names that host only.
    expect(parseOpenAiBaseUrl("https://evil.com\\@api.openai.com")).toBe(
      "https://evil.com/@api.openai.com",
    );
  });
});
