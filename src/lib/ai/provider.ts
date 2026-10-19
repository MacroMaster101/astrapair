import "server-only";
import { getAiConfig } from "./config";
import { OllamaProvider } from "./ollama";
import { OpenAiProvider } from "./openai";
import {
  AiInvalidOutputError,
  AiUnavailableError,
  type AiCallOptions,
  type AiMessage,
  type AiProvider,
  type AiUnavailableReason,
  type AiUsage,
} from "./types";

export { AiInvalidOutputError, AiUnavailableError, type AiUnavailableReason };
export type { AiCallOptions, AiMessage, AiProvider, AiUsage };

export function getAiProvider(): AiProvider {
  const config = getAiConfig();
  if (config.provider === "disabled") throw new AiUnavailableError("disabled");
  if (config.provider === "openai") {
    // A missing or invalid setting is a configuration problem, reported as
    // unavailable (never thrown at import, never naming a value).
    if (!config.openaiApiKey || !config.openaiModel || !config.openaiBaseUrl)
      throw new AiUnavailableError("misconfigured");
    return new OpenAiProvider(
      config.openaiBaseUrl,
      config.openaiApiKey,
      config.openaiModel,
      fetch,
      { reasoningEffort: config.openaiReasoningEffort },
    );
  }
  return new OllamaProvider(
    config.ollamaBaseUrl,
    config.ollamaModel,
    fetch,
    config.ollamaNumCtx,
  );
}
