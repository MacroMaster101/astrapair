import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AiUsage } from "./types";

export type UsageKind = "question" | "report";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Generations in the last 24 hours: a user's questions, or a relationship's
 * reports. Only first attempts count, so a retry does not use up a second
 * daily generation. Reads with the admin client (the table has no policies);
 * callers must have authorized the user or relationship first.
 */
export async function countRecentUsage(
  filter:
    | { userId: string; kind: "question" }
    | { relationshipId: string; kind: "report" },
): Promise<number> {
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const [column, value] =
    "userId" in filter
      ? (["user_id", filter.userId] as const)
      : (["relationship_id", filter.relationshipId] as const);
  const { count, error } = await createAdminClient()
    .from("ai_usage_events")
    .select("id", { count: "exact", head: true })
    .eq("kind", filter.kind)
    .eq(column, value)
    .eq("attempt", 1)
    .gte("created_at", since);
  if (error) throw new Error("Failed to count usage");
  return count ?? 0;
}

const tokens = (n: number) =>
  Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;

/**
 * Records one model call that spent tokens. `attempt` is 1 for the first call
 * of a generation and 2 for its retry. Never throws: usage is bookkeeping.
 */
export async function recordUsage(event: {
  userId: string;
  relationshipId: string | null;
  kind: UsageKind;
  model: string;
  promptVersion: string;
  usage: AiUsage;
  attempt?: number;
}): Promise<void> {
  const context = {
    userId: event.userId,
    relationshipId: event.relationshipId,
    kind: event.kind,
  };
  try {
    const { error } = await createAdminClient()
      .from("ai_usage_events")
      .insert({
        user_id: event.userId,
        relationship_id: event.relationshipId,
        kind: event.kind,
        model: event.model,
        prompt_version: event.promptVersion,
        input_tokens: tokens(event.usage.inputTokens),
        output_tokens: tokens(event.usage.outputTokens),
        attempt: event.attempt ?? 1,
      });
    if (error)
      console.error("Usage record failed", {
        ...context,
        code: error.code || "unknown",
      });
  } catch {
    console.error("Usage record failed", { ...context, code: "config" });
  }
}
