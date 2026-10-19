/** A date such as "Oct 6, 2026", in the reader's locale settings for English. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en", { dateStyle: "medium" });
}
