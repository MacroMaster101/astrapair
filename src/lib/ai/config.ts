import "server-only";

export interface AiConfig {
  provider: "ollama" | "disabled";
  ollamaBaseUrl: string;
  ollamaModel: string;
  /** Context window sent to Ollama; its own default (4096) is too small for a report. */
  ollamaNumCtx: number;
  dailyQuestionLimit: number;
  dailyReportLimit: number;
}

export const DEFAULT_OLLAMA_NUM_CTX = 8192;

const positiveInt = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export function parseAiConfig(
  env: Record<string, string | undefined>,
): AiConfig {
  return {
    provider:
      env.AI_PROVIDER?.trim().toLowerCase() === "disabled"
        ? "disabled"
        : "ollama",
    ollamaBaseUrl: (
      env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434"
    ).replace(/\/+$/, ""),
    ollamaModel: env.OLLAMA_MODEL?.trim() || "qwen2.5:7b",
    ollamaNumCtx: positiveInt(env.OLLAMA_NUM_CTX, DEFAULT_OLLAMA_NUM_CTX),
    dailyQuestionLimit: positiveInt(env.AI_DAILY_QUESTION_LIMIT, 30),
    dailyReportLimit: positiveInt(env.AI_DAILY_REPORT_LIMIT, 3),
  };
}

export const getAiConfig = () => parseAiConfig(process.env);
