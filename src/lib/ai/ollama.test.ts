import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { OllamaProvider } from "./ollama";
import { AiInvalidOutputError, AiUnavailableError } from "./types";

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const opts = { maxTokens: 100, timeoutMs: 1000 };

describe("OllamaProvider", () => {
  it("posts a non-streaming chat and returns text and usage", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok({
        message: { role: "assistant", content: "Hello" },
        prompt_eval_count: 12,
        eval_count: 3,
      }),
    );
    const p = new OllamaProvider("http://h:1", "m", fetchImpl);
    const r = await p.chat([{ role: "user", content: "Hi" }], opts);
    expect(r).toEqual({
      text: "Hello",
      usage: { inputTokens: 12, outputTokens: 3 },
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("http://h:1/api/chat");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      model: "m",
      stream: false,
      options: { num_predict: 100 },
    });
    expect(body.format).toBeUndefined();
  });

  it("sends the context window as num_ctx on chat and JSON calls", async () => {
    const reply = () =>
      ok({ message: { content: '{"a":1}' }, prompt_eval_count: 1 });
    const fetchImpl = vi.fn().mockImplementation(async () => reply());
    const defaulted = new OllamaProvider("http://h:1", "m", fetchImpl);
    await defaulted.chat([{ role: "user", content: "x" }], opts);
    await defaulted.generateJson([], {}, opts);
    const custom = new OllamaProvider("http://h:1", "m", fetchImpl, 4096);
    await custom.chat([{ role: "user", content: "x" }], opts);
    await custom.generateJson([], {}, opts);
    const sent = fetchImpl.mock.calls.map(
      ([, init]) => JSON.parse(init.body).options,
    );
    expect(sent.map((o) => o.num_ctx)).toEqual([8192, 8192, 4096, 4096]);
    expect(sent[0]).toMatchObject({ num_predict: 100 });
  });

  it("sends the JSON schema as format and parses the JSON reply", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok({
        message: { content: '{"a":1}' },
        prompt_eval_count: 1,
        eval_count: 1,
      }),
    );
    const p = new OllamaProvider("http://h:1", "m", fetchImpl);
    const r = await p.generateJson(
      [{ role: "user", content: "x" }],
      { type: "object" },
      opts,
    );
    expect(r.json).toEqual({ a: 1 });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).format).toEqual({
      type: "object",
    });
  });

  it("maps a refused connection to offline", async () => {
    const p = new OllamaProvider(
      "http://h:1",
      "m",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );
    await expect(p.chat([], opts)).rejects.toMatchObject({ reason: "offline" });
  });

  it("maps a missing model to model_missing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'model "m" not found, try pulling it first',
        }),
        { status: 404 },
      ),
    );
    await expect(
      new OllamaProvider("http://h:1", "m", fetchImpl).chat([], opts),
    ).rejects.toMatchObject({ reason: "model_missing" });
  });

  it("maps a timeout to timeout", async () => {
    const err = new DOMException("The operation timed out.", "TimeoutError");
    await expect(
      new OllamaProvider(
        "http://h:1",
        "m",
        vi.fn().mockRejectedValue(err),
      ).chat([], opts),
    ).rejects.toMatchObject({ reason: "timeout" });
  });

  it("maps an abort error to timeout", async () => {
    const err = new DOMException("Aborted", "AbortError");
    await expect(
      new OllamaProvider(
        "http://h:1",
        "m",
        vi.fn().mockRejectedValue(err),
      ).chat([], opts),
    ).rejects.toMatchObject({ reason: "timeout" });
  });

  it("maps other failures and malformed response bodies to error", async () => {
    const bad = new OllamaProvider(
      "http://h:1",
      "m",
      vi.fn().mockResolvedValue(new Response("oops", { status: 500 })),
    );
    await expect(bad.chat([], opts)).rejects.toMatchObject({
      reason: "error",
    });
    const malformed = new OllamaProvider(
      "http://h:1",
      "m",
      vi.fn().mockResolvedValue(ok({ nope: true })),
    );
    await expect(malformed.chat([], opts)).rejects.toMatchObject({
      reason: "error",
    });
  });

  it("throws AiInvalidOutputError with usage on unparseable JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok({
        message: { content: "not json" },
        prompt_eval_count: 7,
        eval_count: 9,
      }),
    );
    const p = new OllamaProvider("http://h:1", "m", fetchImpl);
    const error = await p.generateJson([], {}, opts).catch((e) => e);
    expect(error).toBeInstanceOf(AiInvalidOutputError);
    expect(error).not.toBeInstanceOf(AiUnavailableError);
    expect(error.name).toBe("AiInvalidOutputError");
    expect(error.usage).toEqual({ inputTokens: 7, outputTokens: 9 });
  });

  it("throws AiInvalidOutputError with usage on empty chat text", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok({
        message: { content: "   " },
        prompt_eval_count: 1,
        eval_count: 2,
      }),
    );
    const p = new OllamaProvider("http://h:1", "m", fetchImpl);
    const error = await p.chat([], opts).catch((e) => e);
    expect(error).toBeInstanceOf(AiInvalidOutputError);
    expect(error.usage).toEqual({ inputTokens: 1, outputTokens: 2 });
  });

  it("throws AiInvalidOutputError on done_reason length in generateJson", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok({
        message: { content: '{"a":1}' },
        prompt_eval_count: 4,
        eval_count: 3000,
        done_reason: "length",
      }),
    );
    const p = new OllamaProvider("http://h:1", "m", fetchImpl);
    const error = await p.generateJson([], {}, opts).catch((e) => e);
    expect(error).toBeInstanceOf(AiInvalidOutputError);
    expect(error.usage).toEqual({ inputTokens: 4, outputTokens: 3000 });
  });
});
