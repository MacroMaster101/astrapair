import "server-only";
import { z } from "zod";
import { DEFAULT_OLLAMA_NUM_CTX } from "./config";
import {
  AiInvalidOutputError,
  AiUnavailableError,
  type AiCallOptions,
  type AiMessage,
  type AiProvider,
  type AiUsage,
} from "./types";

const responseSchema = z.object({
  message: z.object({ content: z.string() }),
  prompt_eval_count: z.number().int().nonnegative().optional(),
  eval_count: z.number().int().nonnegative().optional(),
  done_reason: z.string().optional(),
});

export class OllamaProvider implements AiProvider {
  readonly name = "ollama";

  constructor(
    private readonly baseUrl: string,
    readonly model: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly numCtx: number = DEFAULT_OLLAMA_NUM_CTX,
  ) {}

  async chat(messages: AiMessage[], opts: AiCallOptions) {
    const { content, usage } = await this.call(messages, undefined, opts);
    const text = content.trim();
    if (!text) throw new AiInvalidOutputError(usage);
    return { text, usage };
  }

  async generateJson(
    messages: AiMessage[],
    jsonSchema: object,
    opts: AiCallOptions,
  ) {
    const { content, usage, doneReason } = await this.call(
      messages,
      jsonSchema,
      opts,
    );
    // A cut-off answer is not valid JSON output, even if it happens to parse.
    if (doneReason === "length") throw new AiInvalidOutputError(usage);
    try {
      return { json: JSON.parse(content) as unknown, usage };
    } catch {
      throw new AiInvalidOutputError(usage);
    }
  }

  private async call(
    messages: AiMessage[],
    format: object | undefined,
    opts: AiCallOptions,
  ): Promise<{ content: string; usage: AiUsage; doneReason?: string }> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(opts.timeoutMs),
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: false,
          ...(format ? { format } : {}),
          options: {
            temperature: 0.4,
            num_predict: opts.maxTokens,
            num_ctx: this.numCtx,
          },
          keep_alive: "10m",
        }),
      });
    } catch (e) {
      const name = (e as { name?: string }).name;
      throw new AiUnavailableError(
        name === "TimeoutError" || name === "AbortError"
          ? "timeout"
          : "offline",
      );
    }
    if (res.status === 404) throw new AiUnavailableError("model_missing");
    if (!res.ok) throw new AiUnavailableError("error");
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new AiUnavailableError("error");
    }
    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) throw new AiUnavailableError("error");
    return {
      content: parsed.data.message.content,
      usage: {
        inputTokens: parsed.data.prompt_eval_count ?? 0,
        outputTokens: parsed.data.eval_count ?? 0,
      },
      doneReason: parsed.data.done_reason,
    };
  }
}
