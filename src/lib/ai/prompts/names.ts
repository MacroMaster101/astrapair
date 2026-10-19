// Control characters, including newlines and tabs.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;

/** Text with control characters and newlines removed and whitespace collapsed. */
export function cleanText(text: string): string {
  return text.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
}

const NAME_LIMIT = 40;

/** A display name made safe to place in a prompt. */
export function sanitizeName(name: string, fallback: string): string {
  const cleaned = cleanText(name).slice(0, NAME_LIMIT).trim();
  return cleaned || fallback;
}
