import { BuiltInProvider } from "./engine";
import type { AstrologyProvider } from "./types";

let provider: AstrologyProvider | undefined;

/** The active calculation provider. Swap the implementation here to change engines. */
export function getAstrologyProvider(): AstrologyProvider {
  provider ??= new BuiltInProvider();
  return provider;
}
