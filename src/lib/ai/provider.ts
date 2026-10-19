import "server-only";
import { getAiConfig } from "./config";
import { OllamaProvider } from "./ollama";
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
  return new OllamaProvider(
    config.ollamaBaseUrl,
    config.ollamaModel,
    fetch,
    config.ollamaNumCtx,
  );
}
