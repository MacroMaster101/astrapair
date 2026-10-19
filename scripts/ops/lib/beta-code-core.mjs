// Pure helpers for scripts/ops/beta-code.mjs: code generation, hashing and
// argument parsing. No I/O, so they run in the normal test suite
// (src/lib/beta/code.test.ts).

import { createHash, randomInt } from "node:crypto";
import { normalizeCode } from "./beta-code-normalize.mjs";

export { formatCode, normalizeCode } from "./beta-code-normalize.mjs";

/** 31 characters with no 0/O or 1/I/L, so a code survives being read aloud. */
export const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 12;

export const DEFAULT_USES = 1;
export const MAX_USES = 100000;
export const MAX_LABEL_LENGTH = 80;

export class UsageError extends Error {}

export const USAGE = [
  "usage:",
  "  pnpm ops:beta-code create <label> [--uses N]   make a code (default 1 use)",
  "  pnpm ops:beta-code list                         show labels and use counts",
  "  pnpm ops:beta-code disable <label>              stop a code working",
  "",
  "Keep multi-use codes short-lived and disable them once the cohort has joined:",
  "a code can linger in sign-up metadata if the app's clean-up fails.",
].join("\n");

/**
 * A random invite code. `randomIntFn` is injectable for tests; the default is
 * crypto.randomInt, which is uniform (no modulo bias).
 */
export function generateCode(randomIntFn = randomInt) {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += ALPHABET[randomIntFn(ALPHABET.length)];
  }
  return code;
}

/**
 * The only form of a code that is stored or compared: sha256 hex of the utf8
 * bytes of the normalised code (trim, no spaces or hyphens, upper-case), so
 * "abcd-2345-wxyz" and "ABCD2345WXYZ" are the same code.
 */
export function hashCode(code) {
  return createHash("sha256").update(normalizeCode(code), "utf8").digest("hex");
}

function parseLabel(raw) {
  const label = (raw ?? "").trim();
  if (!label) throw new UsageError(`a label is required.\n${USAGE}`);
  if (label.length > MAX_LABEL_LENGTH) {
    throw new UsageError(
      `the label must be at most ${MAX_LABEL_LENGTH} characters.`,
    );
  }
  return label;
}

function parseUses(raw) {
  if (raw === undefined || !/^\d+$/.test(raw)) {
    throw new UsageError(
      `--uses needs a whole number from 1 to ${MAX_USES}.\n${USAGE}`,
    );
  }
  const uses = Number(raw);
  if (uses < 1 || uses > MAX_USES) {
    throw new UsageError(
      `--uses needs a whole number from 1 to ${MAX_USES}.\n${USAGE}`,
    );
  }
  return uses;
}

/** Turns argv (after the script name) into a command, or throws UsageError. */
export function parseCommand(argv) {
  const [command, ...rest] = argv;
  const positional = [];
  let uses = DEFAULT_USES;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--uses" || arg.startsWith("--uses=")) {
      if (command !== "create") {
        throw new UsageError(`--uses only applies to create.\n${USAGE}`);
      }
      if (arg === "--uses") {
        i += 1;
        uses = parseUses(rest[i]);
      } else {
        uses = parseUses(arg.slice("--uses=".length));
      }
    } else if (arg.startsWith("--")) {
      throw new UsageError(`unknown option ${arg}.\n${USAGE}`);
    } else {
      positional.push(arg);
    }
  }

  switch (command) {
    case "create":
    case "disable":
      if (positional.length > 1) {
        throw new UsageError(
          `give the label as one argument (quote it if it has spaces).\n${USAGE}`,
        );
      }
      return command === "create"
        ? { command, label: parseLabel(positional[0]), uses }
        : { command, label: parseLabel(positional[0]) };
    case "list":
      if (positional.length > 0) {
        throw new UsageError(`list takes no arguments.\n${USAGE}`);
      }
      return { command };
    default:
      throw new UsageError(`unknown or missing command.\n${USAGE}`);
  }
}
