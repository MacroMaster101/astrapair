import { createHash } from "node:crypto";
import type { BirthInput } from "./types";

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Stable fingerprint of the calculation input; changes when anything that affects the chart changes. */
export function inputHash(input: BirthInput, engineVersion: string): string {
  const canonical = JSON.stringify([
    engineVersion,
    input.birthDate,
    input.birthTime,
    input.accuracy,
    round6(input.latitude),
    round6(input.longitude),
    input.timezone,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}
