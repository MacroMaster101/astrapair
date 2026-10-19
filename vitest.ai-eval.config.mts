import { readFileSync } from "node:fs";
import tsconfigPaths from "vite-tsconfig-paths";
import { parseOpenAiBaseUrl } from "./src/lib/ai/openai-base-url";
import { defineConfig } from "vitest/config";

// The `ai:eval` script passes `--configLoader runner`, so the TypeScript import
// above (shared with the app) loads like the rest of the code, without Vite's
// warning about the native config loader.

// Live check of the real model: needs a local Ollama (the default), or OpenAI
// when AI_PROVIDER=openai with OPENAI_API_KEY and OPENAI_MODEL set. No
// database. Only the provider settings below are read from .env (when they are
// not already in the environment), so no other value in that file reaches the
// test process. The OpenAI key is never printed or written anywhere.
const ENV_KEYS = [
  "AI_PROVIDER",
  "OLLAMA_BASE_URL",
  "OLLAMA_MODEL",
  "OLLAMA_NUM_CTX",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENAI_BASE_URL",
  "OPENAI_REASONING_EFFORT",
];
try {
  const file = readFileSync(".env", "utf8");
  for (const key of ENV_KEYS) {
    // A variable that is set, even to an empty string, wins over .env.
    if (process.env[key] !== undefined) continue;
    const line = file.match(new RegExp(`^${key}=(.*)$`, "m"));
    const value = line?.[1].trim().replace(/^(["'])(.*)\1$/, "$2");
    if (value) process.env[key] = value;
  }
} catch {
  // No .env file: the defaults apply.
}

// Is there a model to talk to? The answer goes to the test in AI_EVAL_READY,
// and the skip line is printed here because the reporter hides console output
// from a file whose tests are all skipped. No setting from .env is ever printed:
// the lines say "the configured server" and "the configured model". The
// defaults match parseAiConfig in src/lib/ai/config.ts, which cannot be
// imported here (it is server-only); the OpenAI base URL rules are shared.
const providerName = process.env.AI_PROVIDER?.trim().toLowerCase();
const provider =
  providerName === "openai" || providerName === "disabled"
    ? providerName
    : "ollama";

const ollamaBaseUrl = (
  process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434"
).replace(/\/+$/, "");
const ollamaModel = process.env.OLLAMA_MODEL?.trim() || "qwen2.5:7b";

async function whyOllamaNotReady(): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(`${ollamaBaseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    return "Ollama is not reachable at the configured server";
  }
  if (!res.ok)
    return `the configured Ollama server answered ${res.status} to /api/tags`;
  let names: string[] = [];
  try {
    const body = (await res.json()) as { models?: { name?: string }[] };
    names = (body.models ?? []).flatMap((m) => (m.name ? [m.name] : []));
  } catch {
    // An unreadable list counts as no model.
  }
  const found = names.some(
    (n) =>
      n === ollamaModel ||
      (!ollamaModel.includes(":") && n === `${ollamaModel}:latest`),
  );
  return found
    ? null
    : "the configured model is not pulled on that server (pull it with ollama pull)";
}

// Needs the key and the model. One probe, GET /v1/models/{model}, which lists a
// model and costs no tokens, so a wrong key or model name is reported before any
// question is sent.
async function whyOpenAiNotReady(): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim();
  if (!key && !model)
    return "AI_PROVIDER is openai but OPENAI_API_KEY and OPENAI_MODEL are not set";
  if (!key) return "AI_PROVIDER is openai but OPENAI_API_KEY is not set";
  if (!model) return "AI_PROVIDER is openai but OPENAI_MODEL is not set";
  // The same rules as the app (src/lib/ai/openai-base-url.ts).
  const base = parseOpenAiBaseUrl(process.env.OPENAI_BASE_URL);
  if (!base)
    return "OPENAI_BASE_URL is not allowed (use https, or http on localhost)";
  let res: Response;
  try {
    res = await fetch(`${base}/v1/models/${encodeURIComponent(model)}`, {
      headers: { authorization: `Bearer ${key}` },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return "the configured OpenAI server is not reachable";
  }
  if (res.status === 401 || res.status === 403)
    return "the configured OpenAI key was refused";
  if (res.status === 404) return "the configured OpenAI model was not found";
  if (!res.ok)
    return `the configured OpenAI server answered ${res.status} to the model check`;
  return null;
}

async function whyNotReady(): Promise<string | null> {
  if (provider === "disabled")
    return "AI_PROVIDER is disabled, so there is no model to run";
  return provider === "openai" ? whyOpenAiNotReady() : whyOllamaNotReady();
}

const why = await whyNotReady();
if (why) console.log(`AI eval skipped: ${why}. Nothing was run.`);

// The test uses exactly what was checked.
process.env.OLLAMA_BASE_URL = ollamaBaseUrl;
process.env.OLLAMA_MODEL = ollamaModel;
process.env.AI_EVAL_READY = why ? "0" : "1";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/ai-eval/**/*.test.ts"],
    // A local model can take most of a minute per answer, twice per question.
    testTimeout: 300_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    // The summary table is printed by the test; the default reporter hides a
    // passing run's console output, so show it when there is a model to run.
    reporters: why ? ["default"] : ["verbose"],
  },
});
