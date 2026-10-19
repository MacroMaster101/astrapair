import { readFileSync } from "node:fs";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Live check of the real model: needs a local Ollama and nothing else. No
// database, no secrets. Only the three OLLAMA_* settings are read from .env
// (when they are not already in the environment), so no other value in that
// file reaches the test process.
const OLLAMA_KEYS = ["OLLAMA_BASE_URL", "OLLAMA_MODEL", "OLLAMA_NUM_CTX"];
try {
  const file = readFileSync(".env", "utf8");
  for (const key of OLLAMA_KEYS) {
    if (process.env[key]) continue;
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
// the lines say "the configured server" and "the configured model". The defaults match parseAiConfig in
// src/lib/ai/config.ts, which cannot be imported here (it is server-only).
const baseUrl = (
  process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434"
).replace(/\/+$/, "");
const model = process.env.OLLAMA_MODEL?.trim() || "qwen2.5:7b";

async function whyNotReady(): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/tags`, {
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
    (n) => n === model || (!model.includes(":") && n === `${model}:latest`),
  );
  return found
    ? null
    : "the configured model is not pulled on that server (pull it with ollama pull)";
}

const why = await whyNotReady();
if (why) console.log(`AI eval skipped: ${why}. Nothing was run.`);

// The test uses exactly what was probed.
process.env.OLLAMA_BASE_URL = baseUrl;
process.env.OLLAMA_MODEL = model;
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
