import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { OllamaProvider } from "./ollama";
import { OpenAiProvider } from "./openai";
import { AiUnavailableError, getAiProvider } from "./provider";

const ENV_KEYS = [
  "AI_PROVIDER",
  "OLLAMA_BASE_URL",
  "OLLAMA_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENAI_BASE_URL",
  "OPENAI_REASONING_EFFORT",
];

function withEnv(env: Record<string, string>) {
  for (const key of ENV_KEYS) vi.stubEnv(key, "");
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
}

afterEach(() => vi.unstubAllEnvs());

describe("getAiProvider", () => {
  it("returns the Ollama provider by default", () => {
    withEnv({});
    const p = getAiProvider();
    expect(p).toBeInstanceOf(OllamaProvider);
    expect(p.name).toBe("ollama");
    expect(p.model).toBe("qwen2.5:7b");
  });

  it("returns the Ollama provider when AI_PROVIDER=ollama", () => {
    withEnv({ AI_PROVIDER: "ollama", OLLAMA_MODEL: "phi3" });
    expect(getAiProvider().model).toBe("phi3");
  });

  it("throws disabled when AI_PROVIDER=disabled", () => {
    withEnv({ AI_PROVIDER: "disabled" });
    expect(() => getAiProvider()).toThrowError(AiUnavailableError);
    try {
      getAiProvider();
    } catch (e) {
      expect(e).toMatchObject({ reason: "disabled" });
    }
  });

  it("returns the OpenAI provider with the configured model", () => {
    withEnv({
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-test",
      OPENAI_MODEL: "my-model",
    });
    const p = getAiProvider();
    expect(p).toBeInstanceOf(OpenAiProvider);
    expect(p.name).toBe("openai");
    expect(p.model).toBe("my-model");
  });

  it("uses the configured OpenAI base URL and key in the request", async () => {
    withEnv({
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-test",
      OPENAI_MODEL: "my-model",
      OPENAI_BASE_URL: "https://proxy.example.com/v1/",
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: "Hi" } }],
        }),
        { status: 200 },
      ),
    );
    try {
      await getAiProvider().chat([], { maxTokens: 5, timeoutMs: 1000 });
      const [url, init] = fetchSpy.mock.calls[0];
      expect(String(url)).toBe("https://proxy.example.com/v1/chat/completions");
      expect(
        (init!.headers as Record<string, string>).authorization ??
          (init!.headers as Record<string, string>).Authorization,
      ).toBe("Bearer sk-test");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("passes the reasoning effort setting to the OpenAI provider", async () => {
    withEnv({
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-test",
      OPENAI_MODEL: "gpt-5-mini",
      OPENAI_REASONING_EFFORT: "minimal",
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ finish_reason: "stop", message: { content: "Hi" } }],
          }),
          { status: 200 },
        ),
    );
    try {
      await getAiProvider().chat([], { maxTokens: 5, timeoutMs: 1000 });
      expect(
        JSON.parse(fetchSpy.mock.calls[0][1]!.body as string),
      ).toMatchObject({
        reasoning_effort: "minimal",
        max_completion_tokens: 2005,
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it.each([
    ["no key", { OPENAI_MODEL: "m" }],
    ["no model", { OPENAI_API_KEY: "sk-test" }],
    ["no key or model", {}],
    [
      "an invalid base URL",
      {
        OPENAI_API_KEY: "sk-test",
        OPENAI_MODEL: "m",
        OPENAI_BASE_URL: "http://api.example.com",
      },
    ],
  ])("treats OpenAI with %s as misconfigured", (_label, env) => {
    withEnv({ AI_PROVIDER: "openai", ...env });
    let error: unknown;
    try {
      getAiProvider();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AiUnavailableError);
    expect(error).toMatchObject({ reason: "misconfigured" });
    expect((error as Error).message).not.toContain("sk-test");
  });
});
