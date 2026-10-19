import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ReasoningEffort } from "./config";
import {
  AiInvalidOutputError,
  AiUnavailableError,
  type AiCallOptions,
  type AiMessage,
  type AiProvider,
  type AiUsage,
} from "./types";

const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullish(),
        message: z.object({
          content: z.string().nullish(),
          refusal: z.string().nullish(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
    })
    .nullish(),
});

/** Same low temperature as the Ollama provider. */
const TEMPERATURE = 0.4;
const SCHEMA_NAME = "astrapair_response";

/**
 * The one place that says which models are reasoning models: the o-series and
 * the gpt-5 family (not the non-reasoning gpt-5 chat variants). They take
 * reasoning_effort, refuse a custom temperature, and spend part of
 * max_completion_tokens on hidden reasoning.
 */
const isReasoningModel = (model: string) =>
  /^(ft:)?(gpt-5|o\d)/i.test(model) && !/-chat\b/i.test(model);

/** "low" is accepted by the o-series and every gpt-5 model; the owner can override it. */
const DEFAULT_REASONING_EFFORT: ReasoningEffort = "low";

/**
 * Added to max_completion_tokens for reasoning models, so the services' caps
 * (500 for a question, 3000 for a report) still mean visible output. The Chat
 * Completions API has one limit for reasoning and visible text together and no
 * separate cap for the visible part, so a model that reasons little can write up
 * to cap + headroom. The prompts ask for short answers, and the assistant still
 * cuts an answer at 8000 characters.
 */
export const REASONING_HEADROOM_TOKENS = 2000;

/** Strict structured outputs refuse these keywords; our own validation still enforces them. */
const STRICT_UNSUPPORTED = new Set(["minLength", "maxLength"]);
/** Keys whose value is a map of name to sub-schema (names must not be filtered). */
const SCHEMA_MAPS = new Set(["properties", "$defs", "definitions"]);

const NOT_STRICT = Symbol("not strict");

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function strictNode(node: unknown): unknown {
  if (Array.isArray(node)) {
    const items = node.map(strictNode);
    return items.includes(NOT_STRICT) ? NOT_STRICT : items;
  }
  if (!isRecord(node)) return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (STRICT_UNSUPPORTED.has(key)) continue;
    if (SCHEMA_MAPS.has(key)) {
      if (!isRecord(value)) return NOT_STRICT;
      const mapped: Record<string, unknown> = {};
      for (const [name, child] of Object.entries(value)) {
        const walked = strictNode(child);
        if (walked === NOT_STRICT) return NOT_STRICT;
        mapped[name] = walked;
      }
      out[key] = mapped;
      continue;
    }
    const walked = strictNode(value);
    if (walked === NOT_STRICT) return NOT_STRICT;
    out[key] = walked;
  }
  if (node.type === "object") {
    const { properties, required } = node;
    if (!isRecord(properties) || !Array.isArray(required)) return NOT_STRICT;
    if (node.additionalProperties !== false) return NOT_STRICT;
    const names = Object.keys(properties);
    if (
      required.length !== names.length ||
      !names.every((n) => required.includes(n))
    )
      return NOT_STRICT;
  }
  return out;
}

/**
 * A copy of `schema` that OpenAI's strict mode accepts, or null when the schema
 * cannot be strict. Strict mode needs a root object, and every object must list
 * all its properties in `required` and set `additionalProperties: false`. The
 * keywords it refuses (minLength, maxLength) are dropped from the copy; our own
 * validation of the reply still enforces them.
 */
export function toStrictSchema(
  schema: unknown,
): Record<string, unknown> | null {
  if (!isRecord(schema) || schema.type !== "object") return null;
  const result = strictNode(schema);
  return result === NOT_STRICT ? null : (result as Record<string, unknown>);
}

const isAbort = (e: unknown) => {
  const name = (e as { name?: string } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
};

type Field = "temperature" | "reasoning_effort" | "strict";

/** Fields a model refused with a 400, remembered so later calls skip the failed round trip. */
const refusedFields = new Set<string>();

/**
 * Where a refusal is remembered: per base URL and model, and for strict mode
 * also per schema (a fingerprint of it; every caller shares one schema name), so
 * one refused schema does not switch strict mode off for the others.
 */
function refusedKey(
  baseUrl: string,
  model: string,
  field: Field,
  schema: object | undefined,
): string {
  const scope =
    field === "strict" && schema
      ? `|${createHash("sha256").update(JSON.stringify(schema)).digest("hex").slice(0, 16)}`
      : "";
  return `${baseUrl}|${model}|${field}${scope}`;
}

/**
 * Reads a 400 body only to see which request field the API rejected, as one of
 * ours. Nothing else from the body is kept, logged or put in an error.
 */
async function rejectedField(res: Response): Promise<Field | null> {
  try {
    const body = (await res.json()) as { error?: { param?: unknown } } | null;
    const param = body?.error?.param;
    if (typeof param !== "string") return null;
    if (param === "temperature") return "temperature";
    if (param === "reasoning_effort") return "reasoning_effort";
    if (param === "response_format" || param.startsWith("response_format."))
      return "strict";
    return null;
  } catch {
    return null;
  }
}

/** Frees the connection when the body is not going to be read. */
async function discard(res: Response) {
  try {
    await res.body?.cancel();
  } catch {
    // Nothing to free.
  }
}

/** Fixed codes only: never a prompt, an answer, a key or a response body. */
const logAdjusted = (code: string) =>
  console.warn("OpenAI request adjusted", { code });

const ADJUSTED_CODE: Record<Field, string> = {
  temperature: "temperature_rejected",
  reasoning_effort: "reasoning_effort_rejected",
  strict: "strict_schema_rejected",
};

export class OpenAiProvider implements AiProvider {
  readonly name = "openai";
  private readonly reasoningEffort: ReasoningEffort;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    readonly model: string,
    private readonly fetchImpl: typeof fetch = fetch,
    options: { reasoningEffort?: ReasoningEffort | null } = {},
  ) {
    this.reasoningEffort = options.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
  }

  async chat(messages: AiMessage[], opts: AiCallOptions) {
    const { content, usage, finishReason } = await this.call(
      messages,
      undefined,
      opts,
    );
    const text = content.trim();
    if (!text)
      throw new AiInvalidOutputError(
        usage,
        finishReason === "length" ? "length" : undefined,
      );
    return { text, usage };
  }

  async generateJson(
    messages: AiMessage[],
    jsonSchema: object,
    opts: AiCallOptions,
  ) {
    const { content, usage, finishReason } = await this.call(
      messages,
      jsonSchema,
      opts,
    );
    // A cut-off answer is not valid JSON output, even if it happens to parse.
    if (finishReason === "length")
      throw new AiInvalidOutputError(usage, "length");
    try {
      return { json: JSON.parse(content) as unknown, usage };
    } catch {
      throw new AiInvalidOutputError(usage);
    }
  }

  private requestBody(
    messages: AiMessage[],
    schema: object | undefined,
    opts: AiCallOptions,
    dropped: Set<Field>,
  ) {
    const reasoning = isReasoningModel(this.model);
    let responseFormat: object | undefined;
    if (schema) {
      const strict = dropped.has("strict") ? null : toStrictSchema(schema);
      responseFormat = {
        type: "json_schema",
        json_schema: {
          name: SCHEMA_NAME,
          schema: strict ?? schema,
          strict: strict !== null,
        },
      };
    }
    return JSON.stringify({
      model: this.model,
      messages: messages.map(({ role, content }) => ({ role, content })),
      // Hidden reasoning counts against this limit, so a reasoning model gets
      // headroom and the caller's number keeps meaning visible output.
      max_completion_tokens:
        opts.maxTokens + (reasoning ? REASONING_HEADROOM_TOKENS : 0),
      ...(reasoning || dropped.has("temperature")
        ? {}
        : { temperature: TEMPERATURE }),
      ...(reasoning && !dropped.has("reasoning_effort")
        ? { reasoning_effort: this.reasoningEffort }
        : {}),
      store: false,
      ...(responseFormat ? { response_format: responseFormat } : {}),
    });
  }

  private async call(
    messages: AiMessage[],
    schema: object | undefined,
    opts: AiCallOptions,
  ): Promise<{ content: string; usage: AiUsage; finishReason?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const dropped = new Set<Field>(
        (["temperature", "reasoning_effort", "strict"] as const).filter((f) =>
          refusedFields.has(refusedKey(this.baseUrl, this.model, f, schema)),
        ),
      );
      let res: Response;
      for (;;) {
        try {
          res = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${this.apiKey}`,
            },
            // The API never redirects; a proxy that does is a misconfiguration.
            redirect: "error",
            signal: controller.signal,
            body: this.requestBody(messages, schema, opts, dropped),
          });
        } catch (e) {
          throw new AiUnavailableError(
            isAbort(e) || controller.signal.aborted ? "timeout" : "offline",
          );
        }
        if (res.status !== 400) break;
        // A model that refuses one of our optional fields gets one retry
        // without it, for each field.
        const field = await rejectedField(res);
        const sent =
          field === "temperature"
            ? !isReasoningModel(this.model)
            : field === "reasoning_effort"
              ? isReasoningModel(this.model)
              : field === "strict" &&
                schema !== undefined &&
                toStrictSchema(schema) !== null;
        if (!field || !sent || dropped.has(field)) break;
        dropped.add(field);
        refusedFields.add(refusedKey(this.baseUrl, this.model, field, schema));
        logAdjusted(ADJUSTED_CODE[field]);
      }
      if (res.status === 401 || res.status === 403) {
        await discard(res);
        throw new AiUnavailableError("misconfigured");
      }
      if (res.status === 404) {
        await discard(res);
        throw new AiUnavailableError("model_missing");
      }
      if (res.status === 429) {
        await discard(res);
        throw new AiUnavailableError("rate_limited");
      }
      if (!res.ok) {
        await discard(res);
        throw new AiUnavailableError("error");
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch (e) {
        throw new AiUnavailableError(
          isAbort(e) || controller.signal.aborted ? "timeout" : "error",
        );
      }
      const parsed = responseSchema.safeParse(body);
      if (!parsed.success) throw new AiUnavailableError("error");
      const choice = parsed.data.choices[0];
      const usage: AiUsage = {
        inputTokens: parsed.data.usage?.prompt_tokens ?? 0,
        outputTokens: parsed.data.usage?.completion_tokens ?? 0,
      };
      // A refusal or a content-filter stop is an answer we cannot use.
      if (choice.message.refusal)
        throw new AiInvalidOutputError(usage, "refusal");
      if (choice.finish_reason === "content_filter")
        throw new AiInvalidOutputError(usage, "content_filter");
      return {
        content: choice.message.content ?? "",
        usage,
        finishReason: choice.finish_reason ?? undefined,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
