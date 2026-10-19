import "server-only";
import { parseOpenAiBaseUrl } from "./openai-base-url";

export { DEFAULT_OPENAI_BASE_URL } from "./openai-base-url";

export const REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface AiConfig {
  provider: "ollama" | "openai" | "disabled";
  ollamaBaseUrl: string;
  ollamaModel: string;
  /** Context window sent to Ollama; its own default (4096) is too small for a report. */
  ollamaNumCtx: number;
  /** Server-only secret. Null when missing; never log or print it. */
  openaiApiKey: string | null;
  /** No built-in default: the owner chooses the model. Null when missing. */
  openaiModel: string | null;
  /** Null when OPENAI_BASE_URL is set but not allowed (https, or http on localhost). */
  openaiBaseUrl: string | null;
  /** Only used for reasoning models; null means the provider default ("low"). */
  openaiReasoningEffort: ReasoningEffort | null;
  dailyQuestionLimit: number;
  dailyReportLimit: number;
}

export const DEFAULT_OLLAMA_NUM_CTX = 8192;

const positiveInt = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

function parseReasoningEffort(
  value: string | undefined,
): ReasoningEffort | null {
  const v = value?.trim().toLowerCase();
  return REASONING_EFFORTS.find((e) => e === v) ?? null;
}

function parseProvider(value: string | undefined): AiConfig["provider"] {
  const v = value?.trim().toLowerCase();
  return v === "disabled" || v === "openai" ? v : "ollama";
}

export function parseAiConfig(
  env: Record<string, string | undefined>,
): AiConfig {
  return {
    provider: parseProvider(env.AI_PROVIDER),
    ollamaBaseUrl: (
      env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434"
    ).replace(/\/+$/, ""),
    ollamaModel: env.OLLAMA_MODEL?.trim() || "qwen2.5:7b",
    ollamaNumCtx: positiveInt(env.OLLAMA_NUM_CTX, DEFAULT_OLLAMA_NUM_CTX),
    openaiApiKey: env.OPENAI_API_KEY?.trim() || null,
    openaiModel: env.OPENAI_MODEL?.trim() || null,
    openaiBaseUrl: parseOpenAiBaseUrl(env.OPENAI_BASE_URL),
    openaiReasoningEffort: parseReasoningEffort(env.OPENAI_REASONING_EFFORT),
    dailyQuestionLimit: positiveInt(env.AI_DAILY_QUESTION_LIMIT, 30),
    dailyReportLimit: positiveInt(env.AI_DAILY_REPORT_LIMIT, 3),
  };
}

/**
 * The model name of the selected provider, as the provider reports it, or null
 * when there is none (AI disabled, or OpenAI without a model).
 */
export function configuredModel(config: AiConfig): string | null {
  if (config.provider === "disabled") return null;
  return config.provider === "openai" ? config.openaiModel : config.ollamaModel;
}

export const getAiConfig = () => parseAiConfig(process.env);
