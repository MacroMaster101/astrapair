import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { configuredModel, parseAiConfig } from "./config";

describe("parseAiConfig", () => {
  it("uses safe defaults", () => {
    expect(parseAiConfig({})).toEqual({
      provider: "ollama",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "qwen2.5:7b",
      ollamaNumCtx: 8192,
      openaiApiKey: null,
      openaiModel: null,
      openaiBaseUrl: "https://api.openai.com",
      openaiReasoningEffort: null,
      dailyQuestionLimit: 30,
      dailyReportLimit: 3,
    });
  });

  it("reads overrides and trims a trailing slash", () => {
    const c = parseAiConfig({
      AI_PROVIDER: "disabled",
      OLLAMA_BASE_URL: "http://localhost:11434/",
      OLLAMA_MODEL: "phi3",
      OLLAMA_NUM_CTX: "16384",
      AI_DAILY_QUESTION_LIMIT: "5",
      AI_DAILY_REPORT_LIMIT: "1",
    });
    expect(c).toMatchObject({
      provider: "disabled",
      ollamaBaseUrl: "http://localhost:11434",
      ollamaModel: "phi3",
      ollamaNumCtx: 16384,
      dailyQuestionLimit: 5,
      dailyReportLimit: 1,
    });
  });

  it("falls back to defaults for invalid numbers and providers", () => {
    const c = parseAiConfig({
      AI_PROVIDER: "gemini",
      AI_DAILY_QUESTION_LIMIT: "-3",
      AI_DAILY_REPORT_LIMIT: "abc",
    });
    expect(c.provider).toBe("ollama");
    for (const bad of ["0", "-1", "abc", "2.5", ""])
      expect(parseAiConfig({ OLLAMA_NUM_CTX: bad }).ollamaNumCtx).toBe(8192);
    expect(c.dailyQuestionLimit).toBe(30);
    expect(c.dailyReportLimit).toBe(3);
  });

  it("trims and lowercases AI_PROVIDER to detect disabled", () => {
    expect(parseAiConfig({ AI_PROVIDER: "Disabled" }).provider).toBe(
      "disabled",
    );
    expect(parseAiConfig({ AI_PROVIDER: " disabled " }).provider).toBe(
      "disabled",
    );
    expect(parseAiConfig({ AI_PROVIDER: "DISABLED" }).provider).toBe(
      "disabled",
    );
  });

  it("accepts openai, trimmed and in any case", () => {
    for (const value of ["openai", " OpenAI ", "OPENAI"])
      expect(parseAiConfig({ AI_PROVIDER: value }).provider).toBe("openai");
  });

  it("reads the OpenAI key, model and base URL, trimming whitespace and a trailing slash", () => {
    const c = parseAiConfig({
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "  sk-abc  ",
      OPENAI_MODEL: " some-model ",
      OPENAI_BASE_URL: " https://proxy.example.com/ ",
    });
    expect(c).toMatchObject({
      provider: "openai",
      openaiApiKey: "sk-abc",
      openaiModel: "some-model",
      openaiBaseUrl: "https://proxy.example.com",
    });
  });

  it("has no built-in OpenAI key or model, and treats blank values as missing", () => {
    expect(parseAiConfig({ AI_PROVIDER: "openai" })).toMatchObject({
      provider: "openai",
      openaiApiKey: null,
      openaiModel: null,
      openaiBaseUrl: "https://api.openai.com",
    });
    expect(
      parseAiConfig({
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "   ",
        OPENAI_MODEL: "",
        OPENAI_BASE_URL: "  ",
      }),
    ).toMatchObject({
      openaiApiKey: null,
      openaiModel: null,
      openaiBaseUrl: "https://api.openai.com",
    });
  });

  it("does not read OpenAI settings into the Ollama defaults", () => {
    const c = parseAiConfig({
      OPENAI_API_KEY: "sk-abc",
      OPENAI_MODEL: "m",
    });
    expect(c.provider).toBe("ollama");
    expect(c.ollamaModel).toBe("qwen2.5:7b");
  });

  it("allows http only for a local OpenAI base URL", () => {
    for (const url of [
      "http://localhost:8080",
      "http://127.0.0.1:8080/",
      "http://[::1]:8080",
      "https://localhost:8443",
    ])
      expect(
        parseAiConfig({ AI_PROVIDER: "openai", OPENAI_BASE_URL: url })
          .openaiBaseUrl,
      ).toBe(url.replace(/\/+$/, ""));
  });

  it("marks an invalid OpenAI base URL as null", () => {
    for (const url of [
      "http://api.openai.com",
      "http://example.com:8080",
      "http://localhost.evil.com",
      "ftp://localhost",
      "not a url",
      "api.openai.com",
      "https://user:pass@api.openai.com",
    ])
      expect(
        parseAiConfig({ AI_PROVIDER: "openai", OPENAI_BASE_URL: url })
          .openaiBaseUrl,
      ).toBeNull();
  });

  it("normalises a trailing /v1 on the OpenAI base URL", () => {
    expect(
      parseAiConfig({ OPENAI_BASE_URL: "https://proxy.example.com/v1/" })
        .openaiBaseUrl,
    ).toBe("https://proxy.example.com");
  });

  it("reads OPENAI_REASONING_EFFORT, ignoring blank and invalid values", () => {
    for (const v of ["none", "minimal", "low", "medium", "high"])
      expect(
        parseAiConfig({ OPENAI_REASONING_EFFORT: ` ${v.toUpperCase()} ` })
          .openaiReasoningEffort,
      ).toBe(v);
    for (const v of ["", "  ", "max", "extreme", "1", "xhigh"])
      expect(
        parseAiConfig({ OPENAI_REASONING_EFFORT: v }).openaiReasoningEffort,
      ).toBeNull();
  });
});

describe("configuredModel", () => {
  it("names the model of the selected provider, and null when there is none", () => {
    expect(configuredModel(parseAiConfig({ OLLAMA_MODEL: "phi3" }))).toBe(
      "phi3",
    );
    expect(
      configuredModel(
        parseAiConfig({ AI_PROVIDER: "openai", OPENAI_MODEL: "m" }),
      ),
    ).toBe("m");
    expect(
      configuredModel(parseAiConfig({ AI_PROVIDER: "openai" })),
    ).toBeNull();
    expect(
      configuredModel(
        parseAiConfig({ AI_PROVIDER: "disabled", OLLAMA_MODEL: "phi3" }),
      ),
    ).toBeNull();
  });
});
