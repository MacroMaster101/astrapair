export type AiUnavailableReason =
  | "disabled"
  | "offline"
  | "model_missing"
  | "timeout"
  /** A hosted provider refused the credentials, or its settings are missing or invalid. */
  | "misconfigured"
  /** A hosted provider asked us to slow down, or the account is out of quota. */
  | "rate_limited"
  | "error";

export class AiUnavailableError extends Error {
  name = "AiUnavailableError";

  constructor(public readonly reason: AiUnavailableReason) {
    super(`AI unavailable: ${reason}`);
  }
}

/** Why a provider knows an answer is unusable, when it can tell. */
export type AiInvalidOutputCode = "length" | "refusal" | "content_filter";

/**
 * The model answered, but the answer is unusable (unparseable or cut off JSON,
 * empty text). Carries the usage so the spent tokens can still be recorded.
 */
export class AiInvalidOutputError extends Error {
  /**
   * `code` says why, when the provider knows (the answer hit the token limit,
   * the model refused, a content filter stopped it), so logs can tell a budget
   * problem from a bad answer. It never holds any of the text.
   */
  constructor(
    public readonly usage: AiUsage,
    public readonly code?: AiInvalidOutputCode,
  ) {
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
