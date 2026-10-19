export type AiUnavailableReason =
  "disabled" | "offline" | "model_missing" | "timeout" | "error";

export class AiUnavailableError extends Error {
  name = "AiUnavailableError";

  constructor(public readonly reason: AiUnavailableReason) {
    super(`AI unavailable: ${reason}`);
  }
}

/**
 * The model answered, but the answer is unusable (unparseable or cut off JSON,
 * empty text). Carries the usage so the spent tokens can still be recorded.
 */
export class AiInvalidOutputError extends Error {
  constructor(public readonly usage: AiUsage) {
    super("AI returned invalid output");
    this.name = "AiInvalidOutputError";
  }
}

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AiCallOptions {
  maxTokens: number;
  timeoutMs: number;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  generateJson(
    messages: AiMessage[],
    jsonSchema: object,
    opts: AiCallOptions,
  ): Promise<{ json: unknown; usage: AiUsage }>;
  chat(
    messages: AiMessage[],
    opts: AiCallOptions,
  ): Promise<{ text: string; usage: AiUsage }>;
}
