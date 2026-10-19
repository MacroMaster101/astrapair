import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { parseAiConfig } from "./config";

describe("parseAiConfig", () => {
  it("uses safe defaults", () => {
    expect(parseAiConfig({})).toEqual({
      provider: "ollama",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "qwen2.5:7b",
      ollamaNumCtx: 8192,
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
      AI_PROVIDER: "openai",
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
});
