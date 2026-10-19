import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { OpenAiProvider, REASONING_HEADROOM_TOKENS } from "./openai";
import { REPORT_JSON_SCHEMA } from "./report-schema";
import type { ReasoningEffort } from "./config";
import { AiInvalidOutputError, AiUnavailableError } from "./types";

const KEY = "sk-test-SECRET-key-123";
const BASE = "https://api.example.test";
const opts = { maxTokens: 100, timeoutMs: 1000 };

const completion = (
  content: string | null,
  extra: {
    finish_reason?: string | null;
    refusal?: string | null;
    usage?: { prompt_tokens: number; completion_tokens: number };
  } = {},
) => ({
  id: "chatcmpl-1",
  choices: [
    {
      index: 0,
      finish_reason: extra.finish_reason ?? "stop",
      message: {
        role: "assistant",
        content,
        ...(extra.refusal !== undefined ? { refusal: extra.refusal } : {}),
      },
    },
  ],
  usage: extra.usage ?? { prompt_tokens: 12, completion_tokens: 3 },
});

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const provider = (
  fetchImpl: typeof fetch,
  model = "test-model",
  reasoningEffort?: ReasoningEffort | null,
) => new OpenAiProvider(BASE, KEY, model, fetchImpl, { reasoningEffort });

const badRequest = (param: string) =>
  new Response(
    JSON.stringify({
      error: { message: `Unsupported ${param} LEAKED`, param, code: "x" },
    }),
    { status: 400 },
  );

const bodyOf = (fetchImpl: ReturnType<typeof vi.fn>, call = 0) =>
  JSON.parse(fetchImpl.mock.calls[call][1].body);

describe("OpenAiProvider request", () => {
  it("posts a chat completion with the key only in the Authorization header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(completion("Hello")));
    const p = provider(fetchImpl);
    const r = await p.chat(
      [
        { role: "system", content: "Be kind." },
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
        { role: "user", content: "Again" },
      ],
      opts,
    );
    expect(r).toEqual({
      text: "Hello",
      usage: { inputTokens: 12, outputTokens: 3 },
    });
    expect(p.name).toBe("openai");
    expect(p.model).toBe("test-model");

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(`${BASE}/v1/chat/completions`);
    expect(init.method).toBe("POST");
    const headers = Object.fromEntries(
      Object.entries(init.headers as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    expect(headers["content-type"]).toBe("application/json");
    expect(init.signal).toBeInstanceOf(AbortSignal);

    // The key appears nowhere but the Authorization header.
    expect(String(url)).not.toContain(KEY);
    expect(init.body).not.toContain(KEY);
    expect(Object.entries(headers).filter(([, v]) => v.includes(KEY))).toEqual([
      ["authorization", `Bearer ${KEY}`],
    ]);

    const body = bodyOf(fetchImpl);
    expect(body).toMatchObject({
      model: "test-model",
      max_completion_tokens: 100,
      temperature: 0.4,
      store: false,
      messages: [
        { role: "system", content: "Be kind." },
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
        { role: "user", content: "Again" },
      ],
    });
    expect(body.response_format).toBeUndefined();
    expect(body.stream).toBeUndefined();
    expect(body.max_tokens).toBeUndefined();
  });

  it("sends only role and content for each message", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => ok(completion("x")));
    await provider(fetchImpl).chat(
      [{ role: "user", content: "Hi", extra: "no" } as never],
      opts,
    );
    expect(bodyOf(fetchImpl).messages).toEqual([
      { role: "user", content: "Hi" },
    ]);
  });

  it("omits temperature for reasoning models that reject it", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => ok(completion("x")));
    await provider(fetchImpl, "gpt-5-mini").chat([], opts);
    expect(bodyOf(fetchImpl).temperature).toBeUndefined();
  });

  it("retries once without temperature when the model rejects it", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "Unsupported value: 'temperature' does not support 0.4",
              param: "temperature",
              code: "unsupported_value",
            },
          }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(ok(completion("Fine")));
    const r = await provider(fetchImpl, "some-new-model").chat([], opts);
    expect(r.text).toBe("Fine");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchImpl, 0).temperature).toBe(0.4);
    expect(bodyOf(fetchImpl, 1).temperature).toBeUndefined();
  });

  it("does not retry other 400 responses and maps them to error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { param: "messages" } }), {
        status: 400,
      }),
    );
    await expect(provider(fetchImpl).chat([], opts)).rejects.toMatchObject({
      reason: "error",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("OpenAiProvider JSON", () => {
  it("sends a strict json_schema response_format for the report schema and parses the reply", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok(
        completion('{"a":1}', {
          usage: { prompt_tokens: 5, completion_tokens: 6 },
        }),
      ),
    );
    const r = await provider(fetchImpl).generateJson(
      [{ role: "user", content: "x" }],
      REPORT_JSON_SCHEMA,
      opts,
    );
    expect(r).toEqual({
      json: { a: 1 },
      usage: { inputTokens: 5, outputTokens: 6 },
    });
    const { response_format } = bodyOf(fetchImpl);
    expect(response_format.type).toBe("json_schema");
    expect(response_format.json_schema.name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(response_format.json_schema.strict).toBe(true);

    // Strict mode needs every object closed and fully required, and refuses
    // minLength and maxLength; array limits are allowed.
    const sent = response_format.json_schema.schema;
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (n.type === "object" && n.properties) {
        expect(n.additionalProperties).toBe(false);
        expect(n.required).toEqual(Object.keys(n.properties));
      }
      expect(n).not.toHaveProperty("minLength");
      expect(n).not.toHaveProperty("maxLength");
      Object.values(n).forEach(walk);
    };
    walk(sent);
    expect(sent.properties.reflectionQuestions).toMatchObject({
      minItems: 3,
      maxItems: 6,
    });
    expect(
      sent.properties.sections.properties.overview.properties.evidence,
    ).toMatchObject({ maxItems: 8 });
    // The schema the caller passed is not modified.
    expect(JSON.stringify(REPORT_JSON_SCHEMA)).toContain("minLength");
  });

  it("falls back to strict false with the schema as given when it is not strict-compatible", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(completion('{"a":1}')));
    const loose = {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "string" } },
      required: ["a"],
    };
    await provider(fetchImpl).generateJson([], loose, opts);
    const { response_format } = bodyOf(fetchImpl);
    expect(response_format.json_schema.strict).toBe(false);
    expect(response_format.json_schema.schema).toEqual(loose);
  });

  it("falls back to strict false when a nested object is open", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(completion('{"a":1}')));
    const nested = {
      type: "object",
      properties: {
        inner: {
          type: "object",
          properties: { x: { type: "string" } },
          required: ["x"],
        },
      },
      required: ["inner"],
      additionalProperties: false,
    };
    await provider(fetchImpl).generateJson([], nested, opts);
    expect(bodyOf(fetchImpl).response_format.json_schema.strict).toBe(false);
  });

  it("throws AiInvalidOutputError with usage on unparseable JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok(
        completion("not json", {
          usage: { prompt_tokens: 7, completion_tokens: 9 },
        }),
      ),
    );
    const error = await provider(fetchImpl)
      .generateJson([], {}, opts)
      .catch((e) => e);
    expect(error).toBeInstanceOf(AiInvalidOutputError);
    expect(error).not.toBeInstanceOf(AiUnavailableError);
    expect(error.usage).toEqual({ inputTokens: 7, outputTokens: 9 });
  });

  it("throws AiInvalidOutputError on finish_reason length, even if the text parses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok(
        completion('{"a":1}', {
          finish_reason: "length",
          usage: { prompt_tokens: 4, completion_tokens: 3000 },
        }),
      ),
    );
    const error = await provider(fetchImpl)
      .generateJson([], {}, opts)
      .catch((e) => e);
    expect(error).toBeInstanceOf(AiInvalidOutputError);
    expect(error.usage).toEqual({ inputTokens: 4, outputTokens: 3000 });
  });

  it("throws AiInvalidOutputError on empty JSON content", async () => {
    for (const content of [null, "", "  "]) {
      const fetchImpl = vi.fn().mockResolvedValue(ok(completion(content)));
      await expect(
        provider(fetchImpl).generateJson([], {}, opts),
      ).rejects.toBeInstanceOf(AiInvalidOutputError);
    }
  });
});

describe("OpenAiProvider invalid output", () => {
  it("treats a refusal as invalid output in chat and JSON, with usage", async () => {
    const reply = () =>
      ok(
        completion(null, {
          refusal: "I can't help with that.",
          usage: { prompt_tokens: 2, completion_tokens: 1 },
        }),
      );
    const fetchImpl = vi.fn().mockImplementation(async () => reply());
    const p = provider(fetchImpl);
    for (const run of [
      () => p.chat([], opts),
      () => p.generateJson([], {}, opts),
    ]) {
      const error = await run().catch((e) => e);
      expect(error).toBeInstanceOf(AiInvalidOutputError);
      expect(error.usage).toEqual({ inputTokens: 2, outputTokens: 1 });
    }
  });

  it("treats a refusal that comes with text as invalid output", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(ok(completion("Some text", { refusal: "No." })));
    await expect(provider(fetchImpl).chat([], opts)).rejects.toBeInstanceOf(
      AiInvalidOutputError,
    );
  });

  it("treats empty or blank chat text as invalid output with usage", async () => {
    for (const content of [null, "", "   "]) {
      const fetchImpl = vi.fn().mockResolvedValue(
        ok(
          completion(content, {
            usage: { prompt_tokens: 1, completion_tokens: 2 },
          }),
        ),
      );
      const error = await provider(fetchImpl)
        .chat([], opts)
        .catch((e) => e);
      expect(error).toBeInstanceOf(AiInvalidOutputError);
      expect(error.usage).toEqual({ inputTokens: 1, outputTokens: 2 });
    }
  });

  it("treats content_filter as invalid output in chat and JSON", async () => {
    const reply = () =>
      ok(
        completion("partial", {
          finish_reason: "content_filter",
          usage: { prompt_tokens: 3, completion_tokens: 4 },
        }),
      );
    const fetchImpl = vi.fn().mockImplementation(async () => reply());
    const p = provider(fetchImpl);
    for (const run of [
      () => p.chat([], opts),
      () => p.generateJson([], {}, opts),
    ]) {
      const error = await run().catch((e) => e);
      expect(error).toBeInstanceOf(AiInvalidOutputError);
      expect(error.usage).toEqual({ inputTokens: 3, outputTokens: 4 });
    }
  });

  it("returns chat text cut off by length (same as the Ollama provider)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        ok(completion("Cut off", { finish_reason: "length" })),
      );
    const r = await provider(fetchImpl).chat([], opts);
    expect(r.text).toBe("Cut off");
  });

  it("counts missing usage as zero", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok({
        choices: [{ finish_reason: "stop", message: { content: "Hi" } }],
      }),
    );
    const r = await provider(fetchImpl).chat([], opts);
    expect(r.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

describe("OpenAiProvider errors", () => {
  const status = (code: number, text = "") =>
    vi.fn().mockResolvedValue(new Response(text, { status: code }));

  it("maps a refused connection to offline", async () => {
    const p = provider(
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );
    await expect(p.chat([], opts)).rejects.toMatchObject({ reason: "offline" });
    await expect(p.generateJson([], {}, opts)).rejects.toMatchObject({
      reason: "offline",
    });
  });

  it("maps timeout and abort errors to timeout", async () => {
    for (const name of ["TimeoutError", "AbortError"]) {
      const err = new DOMException("gone", name);
      await expect(
        provider(vi.fn().mockRejectedValue(err)).chat([], opts),
      ).rejects.toMatchObject({ reason: "timeout" });
    }
  });

  it("aborts the request at timeoutMs and maps it to timeout", async () => {
    const fetchImpl = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const started = Date.now();
    await expect(
      provider(fetchImpl as unknown as typeof fetch).chat([], {
        maxTokens: 10,
        timeoutMs: 30,
      }),
    ).rejects.toMatchObject({ reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(900);
  });

  it("maps a timeout while reading the body to timeout", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const res = new Response("{}", { status: 200 });
      res.json = () =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      return res;
    });
    await expect(
      provider(fetchImpl as unknown as typeof fetch).chat([], {
        maxTokens: 10,
        timeoutMs: 30,
      }),
    ).rejects.toMatchObject({ reason: "timeout" });
  });

  it("maps 401 and 403 to misconfigured", async () => {
    for (const code of [401, 403]) {
      await expect(provider(status(code)).chat([], opts)).rejects.toMatchObject(
        { reason: "misconfigured" },
      );
    }
  });

  it("maps 404 to model_missing", async () => {
    await expect(provider(status(404)).chat([], opts)).rejects.toMatchObject({
      reason: "model_missing",
    });
  });

  it("maps 429 to rate_limited", async () => {
    await expect(provider(status(429)).chat([], opts)).rejects.toMatchObject({
      reason: "rate_limited",
    });
    await expect(
      provider(status(429)).generateJson([], {}, opts),
    ).rejects.toMatchObject({ reason: "rate_limited" });
  });

  it("maps 5xx and other failures to error", async () => {
    for (const code of [500, 502, 503, 418]) {
      await expect(
        provider(status(code, "oops")).chat([], opts),
      ).rejects.toMatchObject({ reason: "error" });
    }
  });

  it("maps malformed or unexpected response bodies to error", async () => {
    const bodies = [
      new Response("not json", { status: 200 }),
      ok({ nope: true }),
      ok({ choices: [] }),
    ];
    for (const res of bodies) {
      await expect(
        provider(vi.fn().mockResolvedValue(res)).chat([], opts),
      ).rejects.toMatchObject({ reason: "error" });
    }
  });

  it("never puts the key, prompts, answers or response bodies in errors", async () => {
    const secretBody = JSON.stringify({
      error: { message: `Incorrect API key provided: ${KEY}. Also: LEAKED` },
    });
    const prompt = [{ role: "user" as const, content: "my private question" }];
    const attempts: Promise<unknown>[] = [];
    for (const code of [400, 401, 403, 404, 429, 500, 503]) {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(new Response(secretBody, { status: code }));
      attempts.push(
        provider(fetchImpl)
          .chat(prompt, opts)
          .catch((e) => e),
        provider(fetchImpl)
          .generateJson(prompt, {}, opts)
          .catch((e) => e),
      );
    }
    attempts.push(
      provider(vi.fn().mockRejectedValue(new TypeError(`bad ${KEY}`)))
        .chat(prompt, opts)
        .catch((e) => e),
      provider(
        vi
          .fn()
          .mockResolvedValue(
            ok(completion("secret answer text", { refusal: "LEAKED" })),
          ),
      )
        .chat(prompt, opts)
        .catch((e) => e),
      provider(
        vi
          .fn()
          .mockResolvedValue(ok(completion("secret answer text, not json"))),
      )
        .generateJson(prompt, {}, opts)
        .catch((e) => e),
    );
    for (const error of (await Promise.all(attempts)) as Error[]) {
      expect(error).toBeInstanceOf(Error);
      const shown = [
        error.message,
        error.name,
        String(error),
        JSON.stringify(error),
        error.stack ?? "",
        String((error as { cause?: unknown }).cause ?? ""),
      ].join("\n");
      for (const secret of [
        KEY,
        "LEAKED",
        "private question",
        "secret answer",
        "Incorrect API key",
      ])
        expect(shown).not.toContain(secret);
    }
  });
});

describe("OpenAiProvider reasoning models", () => {
  it("names the headroom it adds for hidden reasoning", () => {
    expect(REASONING_HEADROOM_TOKENS).toBe(2000);
  });

  it.each([
    "o3-mini",
    "o1",
    "o4-mini",
    "gpt-5",
    "gpt-5-mini",
    "GPT-5-nano",
    "gpt-5.1",
    "ft:o4-mini-2025-04-16:acme::abc123",
    "ft:gpt-5-mini:acme::abc123",
  ])(
    "sends low reasoning effort and token headroom, and no temperature, for %s",
    async (model) => {
      const fetchImpl = vi
        .fn()
        .mockImplementation(async () => ok(completion("x")));
      await provider(fetchImpl, model).chat([], opts);
      const body = bodyOf(fetchImpl);
      expect(body.reasoning_effort).toBe("low");
      expect(body.max_completion_tokens).toBe(100 + REASONING_HEADROOM_TOKENS);
      expect(body.temperature).toBeUndefined();
    },
  );

  it.each(["gpt-4.1-mini", "gpt-4o", "gpt-5-chat-latest", "my-model"])(
    "treats %s as a normal model: temperature, no reasoning effort, no headroom",
    async (model) => {
      const fetchImpl = vi
        .fn()
        .mockImplementation(async () => ok(completion("x")));
      await provider(fetchImpl, model).chat([], opts);
      const body = bodyOf(fetchImpl);
      expect(body.reasoning_effort).toBeUndefined();
      expect(body.max_completion_tokens).toBe(100);
      expect(body.temperature).toBe(0.4);
    },
  );

  it("uses the configured reasoning effort for a reasoning model only", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => ok(completion("x")));
    await provider(fetchImpl, "gpt-5-mini", "minimal").chat([], opts);
    expect(bodyOf(fetchImpl).reasoning_effort).toBe("minimal");
    await provider(fetchImpl, "gpt-4.1-mini", "minimal").chat([], opts);
    expect(bodyOf(fetchImpl, 1).reasoning_effort).toBeUndefined();
  });

  it("retries once without reasoning_effort when the model rejects it, keeping the rest", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(badRequest("reasoning_effort"))
      .mockResolvedValueOnce(ok(completion('{"a":1}')));
    const r = await provider(fetchImpl, "gpt-5-effort-reject").generateJson(
      [],
      REPORT_JSON_SCHEMA,
      opts,
    );
    expect(r.json).toEqual({ a: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [first, second] = [bodyOf(fetchImpl, 0), bodyOf(fetchImpl, 1)];
    expect(first.reasoning_effort).toBe("low");
    expect(second.reasoning_effort).toBeUndefined();
    expect(second.max_completion_tokens).toBe(first.max_completion_tokens);
    expect(second.response_format).toEqual(first.response_format);
  });

  it("remembers a model that rejected reasoning_effort for later calls", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(badRequest("reasoning_effort"))
      .mockImplementation(async () => ok(completion("x")));
    const p = provider(fetchImpl, "gpt-5-effort-remembered");
    await p.chat([], opts);
    await p.chat([], opts);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(bodyOf(fetchImpl, 2).reasoning_effort).toBeUndefined();
  });
});

describe("OpenAiProvider retries", () => {
  it("keeps response_format when it retries without temperature", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(badRequest("temperature"))
      .mockResolvedValueOnce(ok(completion('{"a":1}')));
    await provider(fetchImpl, "tweaked-model-1").generateJson(
      [],
      REPORT_JSON_SCHEMA,
      opts,
    );
    expect(bodyOf(fetchImpl, 1).temperature).toBeUndefined();
    expect(bodyOf(fetchImpl, 1).response_format).toEqual(
      bodyOf(fetchImpl, 0).response_format,
    );
  });

  it("does not retry the same rejected field twice", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => badRequest("temperature"));
    await expect(
      provider(fetchImpl, "tweaked-model-2").chat([], opts),
    ).rejects.toMatchObject({ reason: "error" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("remembers a refused field per base URL and model, not across them", async () => {
    const rejectOnce = () =>
      vi
        .fn()
        .mockResolvedValueOnce(badRequest("temperature"))
        .mockImplementation(async () => ok(completion("x")));
    const first = rejectOnce();
    await new OpenAiProvider(
      "https://a.example.test",
      KEY,
      "scoped-model",
      first,
    ).chat([], opts);
    expect(first).toHaveBeenCalledTimes(2);
    // Same model on another base URL starts fresh and sends temperature again.
    const other = rejectOnce();
    await new OpenAiProvider(
      "https://b.example.test",
      KEY,
      "scoped-model",
      other,
    ).chat([], opts);
    expect(bodyOf(other, 0).temperature).toBe(0.4);
    // The base URL that refused it keeps skipping it.
    const again = vi.fn().mockImplementation(async () => ok(completion("x")));
    await new OpenAiProvider(
      "https://a.example.test",
      KEY,
      "scoped-model",
      again,
    ).chat([], opts);
    expect(bodyOf(again, 0).temperature).toBeUndefined();
  });

  it("remembers a rejected strict schema per schema, not for every schema", async () => {
    const schemaA = {
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a"],
      additionalProperties: false,
    };
    const schemaB = {
      type: "object",
      properties: { b: { type: "string" } },
      required: ["b"],
      additionalProperties: false,
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(badRequest("response_format"))
      .mockImplementation(async () => ok(completion('{"a":"x"}')));
    const p = provider(fetchImpl, "strict-scoped-model");
    await p.generateJson([], schemaA, opts);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Same schema again: strict is skipped without a failed request.
    await p.generateJson([], schemaA, opts);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(bodyOf(fetchImpl, 2).response_format.json_schema.strict).toBe(false);
    // A different schema still gets strict mode.
    await p.generateJson([], schemaB, opts);
    expect(bodyOf(fetchImpl, 3).response_format.json_schema.strict).toBe(true);
  });

  it("remembers a model that rejected temperature for later calls", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(badRequest("temperature"))
      .mockImplementation(async () => ok(completion("x")));
    const p = provider(fetchImpl, "tweaked-model-3");
    await p.chat([], opts);
    await p.chat([], opts);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(bodyOf(fetchImpl, 2).temperature).toBeUndefined();
  });

  it("retries once with strict false when the response_format is rejected, and logs a code only", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(badRequest("response_format"))
        .mockResolvedValueOnce(ok(completion('{"a":1}')));
      const r = await provider(fetchImpl, "strict-reject-1").generateJson(
        [],
        REPORT_JSON_SCHEMA,
        opts,
      );
      expect(r.json).toEqual({ a: 1 });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      const first = bodyOf(fetchImpl, 0).response_format.json_schema;
      const second = bodyOf(fetchImpl, 1).response_format.json_schema;
      expect(first.strict).toBe(true);
      expect(second.strict).toBe(false);
      expect(second.schema).toEqual(REPORT_JSON_SCHEMA);
      expect(second.name).toBe(first.name);
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).toContain("strict_schema_rejected");
      for (const secret of [KEY, "LEAKED", "Unsupported"])
        expect(logged).not.toContain(secret);
    } finally {
      warn.mockRestore();
    }
  });

  it("also retries when the rejected param is nested under response_format", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(badRequest("response_format.json_schema.schema"))
      .mockResolvedValueOnce(ok(completion('{"a":1}')));
    await provider(fetchImpl, "strict-reject-2").generateJson(
      [],
      REPORT_JSON_SCHEMA,
      opts,
    );
    expect(bodyOf(fetchImpl, 1).response_format.json_schema.strict).toBe(false);
  });

  it("does not retry a rejected response_format that was already not strict", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => badRequest("response_format"));
    await expect(
      provider(fetchImpl, "strict-reject-3").generateJson(
        [],
        { type: "object" },
        opts,
      ),
    ).rejects.toMatchObject({ reason: "error" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not retry a response_format rejection for plain chat", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => badRequest("response_format"));
    await expect(
      provider(fetchImpl, "strict-reject-4").chat([], opts),
    ).rejects.toMatchObject({ reason: "error" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stays within the one timeout across retries", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) return badRequest("temperature");
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    });
    await expect(
      provider(fetchImpl as unknown as typeof fetch, "tweaked-model-4").chat(
        [],
        { maxTokens: 10, timeoutMs: 40 },
      ),
    ).rejects.toMatchObject({ reason: "timeout" });
  });
});

describe("OpenAiProvider transport", () => {
  it("never follows redirects", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => ok(completion("x")));
    await provider(fetchImpl).chat([], opts);
    expect(fetchImpl.mock.calls[0][1].redirect).toBe("error");
  });

  it("maps a redirect error to offline", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new TypeError("fetch failed: unexpected redirect"));
    await expect(provider(fetchImpl).chat([], opts)).rejects.toMatchObject({
      reason: "offline",
    });
  });

  it.each([401, 403, 404, 429, 500, 503])(
    "cancels the unread response body on a %s",
    async (status) => {
      const cancel = vi.fn();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("secret body"));
        },
        cancel,
      });
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(new Response(stream, { status }));
      await expect(provider(fetchImpl).chat([], opts)).rejects.toBeInstanceOf(
        AiUnavailableError,
      );
      expect(cancel).toHaveBeenCalled();
    },
  );
});

describe("OpenAiProvider invalid output codes", () => {
  const reply = (
    extra: Parameters<typeof completion>[1],
    content: string | null,
  ) => vi.fn().mockResolvedValue(ok(completion(content, extra)));

  it("tags a cut-off JSON answer with the length code", async () => {
    const error = await provider(reply({ finish_reason: "length" }, '{"a":'))
      .generateJson([], {}, opts)
      .catch((e) => e);
    expect(error).toBeInstanceOf(AiInvalidOutputError);
    expect(error.code).toBe("length");
  });

  it("tags an empty chat answer that stopped at the limit with the length code", async () => {
    const error = await provider(reply({ finish_reason: "length" }, ""))
      .chat([], opts)
      .catch((e) => e);
    expect(error).toBeInstanceOf(AiInvalidOutputError);
    expect(error.code).toBe("length");
  });

  it("tags a refusal and a content filter stop", async () => {
    const refusal = await provider(reply({ refusal: "No." }, null))
      .chat([], opts)
      .catch((e) => e);
    expect(refusal.code).toBe("refusal");
    const filtered = await provider(
      reply({ finish_reason: "content_filter" }, "x"),
    )
      .chat([], opts)
      .catch((e) => e);
    expect(filtered.code).toBe("content_filter");
  });

  it("leaves the code empty for plain unparseable or empty output", async () => {
    const bad = await provider(reply({}, "not json"))
      .generateJson([], {}, opts)
      .catch((e) => e);
    expect(bad.code).toBeUndefined();
    const empty = await provider(reply({}, "  "))
      .chat([], opts)
      .catch((e) => e);
    expect(empty.code).toBeUndefined();
  });
});
