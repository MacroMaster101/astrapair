import "server-only";
import { getAiConfig } from "@/lib/ai/config";
import {
  buildNatalFacts,
  buildRelationshipFacts,
  withAliases,
  type Claims,
} from "@/lib/ai/facts";
import {
  findUnsupportedClaims,
  rejectedPlacementsNote,
  type UnsupportedClaim,
} from "@/lib/ai/guard";
import {
  POLICY_RETRY_INSTRUCTION,
  countCategories,
  findPolicyFlags,
  findPolicyViolations,
} from "@/lib/ai/policy";
import { sanitizeName } from "@/lib/ai/prompts/names";
import {
  ASSISTANT_PROMPT_VERSION,
  buildChartAssistantMessages,
  buildRelationshipAssistantMessages,
} from "@/lib/ai/prompts/assistant";
import {
  AiInvalidOutputError,
  AiUnavailableError,
  getAiProvider,
  type AiMessage,
  type AiProvider,
  type AiUsage,
} from "@/lib/ai/provider";
import { REPORT_SECTIONS } from "@/lib/ai/report-schema";
import { CRISIS_REPLY, classifyQuestion } from "@/lib/ai/safety";
import { countRecentUsage, recordUsage } from "@/lib/ai/usage";
import { trackAfterResponse } from "@/lib/analytics/track";
import { orientForViewer } from "@/lib/astrology/synastry";
import { getProfile, requireUserId } from "@/lib/auth/session";
import {
  getCurrentChart,
  getOwnBirthProfile,
} from "@/lib/birth-profile/service";
import {
  loadRelationshipContext,
  type RelationshipContext,
} from "@/lib/partner/service";
import { getReportState } from "@/lib/report/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export interface ThreadSummary {
  id: string;
  type: "chart" | "relationship";
  title: string;
  updatedAt: string;
}

export interface ThreadMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export type CreateThreadResult =
  | { ok: true; threadId: string }
  | { ok: false; code: "not_connected" | "no_chart" | "error" };

export type AskResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "not_found"
        | "not_connected"
        | "no_chart"
        | "limit"
        | "ai_unavailable"
        | "error";
    };

type AskCode = Extract<AskResult, { ok: false }>["code"];

const CHART_TITLE = "About my chart";
const RELATIONSHIP_TITLE = "About us";
const DEFAULT_TITLES: readonly string[] = [CHART_TITLE, RELATIONSHIP_TITLE];

const MAX_QUESTION_LENGTH = 500;
const HISTORY_LIMIT = 10;
/** Stored rows read to find HISTORY_LIMIT turns once crisis exchanges are dropped. */
const HISTORY_FETCH_LIMIT = 40;
const LIST_LIMIT = 50;
const MAX_TITLE_LENGTH = 60;
const TITLE_CUT = 57;
const MAX_CONTENT_LENGTH = 8000;
/**
 * Per attempt. Two attempts of 50 s fit under the question page's
 * maxDuration of 120 s, and match the "up to a minute" copy.
 */
const CALL_OPTIONS = { maxTokens: 500, timeoutMs: 50000 };
/** How many of the newest threads of a type are searched for an empty one. */
const EMPTY_THREAD_SEARCH = 20;
const ATTEMPTS = 2;

const RETRY_INSTRUCTION =
  "Your previous answer mentioned placements that are not in the facts. Answer again using only the facts.";
const FALLBACK_ANSWER =
  "I couldn't answer that reliably from your chart facts. Try asking in a different way.";

/** Postgres SQLSTATE raised by the active-relationship trigger. */
const RELATIONSHIP_NOT_ACTIVE = "AP001";
const FOREIGN_KEY_VIOLATION = "23503";
const INVALID_TEXT_REPRESENTATION = "22P02";

const THREAD_COLUMNS = "id, thread_type, title, relationship_id, updated_at";

interface ThreadRow {
  id: string;
  thread_type: string;
  title: string;
  relationship_id: string | null;
  updated_at: string;
}

const toSummary = (row: ThreadRow): ThreadSummary => ({
  id: row.id,
  type: row.thread_type === "relationship" ? "relationship" : "chart",
  title: row.title,
  updatedAt: row.updated_at,
});

/**
 * Logs what the flag tier of the policy filter found in an answer that is
 * about to be shown, as category counts: never the answer, the matched words
 * or a name. Monitoring only: it never throws and never changes the outcome.
 */
function logFlags(threadId: string, text: string, names: string[]) {
  try {
    const flags = countCategories(findPolicyFlags(text, { names }));
    if (Object.keys(flags).length > 0)
      console.info("Assistant answer flagged", { threadId, flags });
  } catch {
    // Nothing to do: the answer is shown either way.
  }
}

/** Logs ids, a stage and a code only: never question or answer text. */
function logFailure(threadId: string | null, stage: string, code: string) {
  console.error("Assistant failed", { threadId, stage, code });
}

const dbCode = (e: { code?: string | null }) => e.code || "unknown";

export async function listThreads(): Promise<ThreadSummary[]> {
  await requireUserId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_threads")
    .select(THREAD_COLUMNS)
    .order("updated_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) throw new Error("Failed to load threads");
  return (data ?? []).map(toSummary);
}

export async function getThread(
  threadId: string,
): Promise<{ thread: ThreadSummary; messages: ThreadMessage[] } | null> {
  await requireUserId();
  const supabase = await createClient();
  const { data: thread, error } = await supabase
    .from("ai_threads")
    .select(THREAD_COLUMNS)
    .eq("id", threadId)
    .maybeSingle();
  // A malformed id in the URL is simply a thread nobody can see.
  if (error?.code === INVALID_TEXT_REPRESENTATION) return null;
  if (error) throw new Error("Failed to load thread");
  if (!thread) return null;

  const { data: messages, error: messagesError } = await supabase
    .from("ai_messages")
    .select("id, role, content, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  if (messagesError) throw new Error("Failed to load messages");
  return {
    thread: toSummary(thread),
    messages: (messages ?? []).map((m) => ({
      id: m.id,
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
      createdAt: m.created_at,
    })),
  };
}

/**
 * The user's newest thread of this type that has no messages yet, so starting
 * a conversation twice does not leave a trail of empty threads. Null when there
 * is none, or when the lookup fails (the caller then creates a thread).
 */
async function findEmptyThread(
  userId: string,
  type: "chart" | "relationship",
  relationshipId: string | null,
): Promise<string | null> {
  const supabase = await createClient();
  let query = supabase
    .from("ai_threads")
    .select("id, ai_messages(id)")
    .eq("owner_user_id", userId)
    .eq("thread_type", type);
  if (relationshipId) query = query.eq("relationship_id", relationshipId);
  const { data, error } = await query
    .order("updated_at", { ascending: false })
    .limit(EMPTY_THREAD_SEARCH)
    .limit(1, { referencedTable: "ai_messages" });
  if (error) {
    logFailure(null, "find-empty", dbCode(error));
    return null;
  }
  return data?.find((t) => t.ai_messages.length === 0)?.id ?? null;
}

export async function createThread(
  type: "chart" | "relationship",
): Promise<CreateThreadResult> {
  const userId = await requireUserId();
  try {
    let relationshipId: string | null = null;
    if (type === "chart") {
      const profile = await getOwnBirthProfile();
      const result = profile ? await getCurrentChart(profile) : null;
      if (!result?.chart) return { ok: false, code: "no_chart" };
    } else {
      const context = await loadRelationshipContext();
      if (!context) return { ok: false, code: "not_connected" };
      relationshipId = context.relationshipId;
    }

    const reusable = await findEmptyThread(userId, type, relationshipId);
    if (reusable) return { ok: true, threadId: reusable };

    const { data, error } = await createAdminClient()
      .from("ai_threads")
      .insert({
        owner_user_id: userId,
        relationship_id: relationshipId,
        thread_type: type,
        title: type === "chart" ? CHART_TITLE : RELATIONSHIP_TITLE,
      })
      .select("id")
      .single();
    if (error) {
      logFailure(null, "create", dbCode(error));
      return {
        ok: false,
        code:
          error.code === RELATIONSHIP_NOT_ACTIVE ? "not_connected" : "error",
      };
    }
    return { ok: true, threadId: data.id };
  } catch {
    logFailure(null, "create", "exception");
    return { ok: false, code: "error" };
  }
}

export async function getRemainingQuestions(): Promise<number> {
  const userId = await requireUserId();
  const used = await countRecentUsage({ userId, kind: "question" });
  return Math.max(0, getAiConfig().dailyQuestionLimit - used);
}

/** The question as a thread title: at most 60 characters, cut at a word. */
export function titleFromQuestion(question: string): string {
  const text = question.replace(/\s+/g, " ").trim();
  if (text.length <= MAX_TITLE_LENGTH) return text;
  const head = text.slice(0, TITLE_CUT);
  const atBoundary = /\s/.test(text.charAt(TITLE_CUT));
  const lastSpace = head.lastIndexOf(" ");
  const cut = atBoundary || lastSpace <= 0 ? head : head.slice(0, lastSpace);
  return `${cut.trimEnd()}...`;
}

/** The viewer's natal claims merged into the relationship claims. */
function mergeClaims(natal: Claims, relationship: Claims): Claims {
  const union = <T>(...sets: (Set<T> | undefined)[]) =>
    new Set(sets.flatMap((s) => [...(s ?? [])]));
  const a = relationship.owners?.a;
  const b = relationship.owners?.b;
  return {
    signs: union(natal.signs, relationship.signs),
    aspects: union(natal.aspects, relationship.aspects),
    houses: union(natal.houses, relationship.houses),
    owners: {
      ...(a && {
        a: {
          aliases: a.aliases,
          signs: union(a.signs, natal.owners?.a?.signs),
          houses: union(a.houses, natal.owners?.a?.houses),
        },
      }),
      ...(b && { b }),
    },
  };
}

interface Prepared {
  messages: AiMessage[];
  claims: Claims;
  /** The display names the prompt uses, for the policy filter. */
  names: string[];
}

async function reportSummaries(): Promise<string[] | null> {
  try {
    const state = await getReportState();
    // An out-of-date report describes old birth details: leave it out.
    if (state.kind !== "ready" || state.outOfDate) return null;
    const { sections } = state.report.interpretation;
    return REPORT_SECTIONS.map((s) => sections[s.key].summary);
  } catch {
    return null;
  }
}

async function prepareRelationship(
  context: RelationshipContext,
  history: AiMessage[],
  question: string,
  sensitive: boolean,
): Promise<Prepared | AskCode> {
  if (context.error) return "error";
  if (!context.viewerChart || context.chartsMissing || !context.synastry)
    return "no_chart";
  const names = {
    a: sanitizeName(context.names.viewer, "You"),
    b: sanitizeName(context.names.partner, "Your partner"),
  };
  const viewer = buildNatalFacts(context.viewerChart);
  const relationship = buildRelationshipFacts({
    names,
    a: context.viewer,
    b: context.partner,
    synastry: orientForViewer(context.synastry, context.viewerIsA),
  });
  return {
    messages: buildRelationshipAssistantMessages({
      viewerName: names.a,
      partnerName: names.b,
      viewer,
      relationship,
      reportSummaries: await reportSummaries(),
      history,
      question,
      sensitive,
    }),
    claims: withAliases(mergeClaims(viewer.claims, relationship.claims), {
      a: ["your", "my"],
      b: ["their", "his", "her"],
    }),
    names: [
      sanitizeName(context.names.viewer, ""),
      sanitizeName(context.names.partner, ""),
    ].filter(Boolean),
  };
}

async function prepareChart(
  history: AiMessage[],
  question: string,
  sensitive: boolean,
): Promise<Prepared | AskCode> {
  const profile = await getOwnBirthProfile();
  if (!profile) return "no_chart";
  const result = await getCurrentChart(profile);
  if (!result.chart) return "error";
  const facts = buildNatalFacts(result.chart);
  const { display_name } = await getProfile();
  return {
    messages: buildChartAssistantMessages({
      name: sanitizeName(display_name ?? "", "You"),
      facts,
      history,
      question,
      sensitive,
    }),
    claims: withAliases(facts.claims, { a: ["your", "my"] }),
    names: [],
  };
}

/**
 * The retry's messages: the same conversation plus a corrective line for each
 * kind of problem the first answer had (usually one, sometimes both).
 */
function withRetryInstructions(
  messages: AiMessage[],
  problems: { unsupported: UnsupportedClaim[]; policy: boolean },
): AiMessage[] {
  const lines = [
    ...(problems.unsupported.length > 0
      ? [RETRY_INSTRUCTION + rejectedPlacementsNote(problems.unsupported)]
      : []),
    ...(problems.policy ? [POLICY_RETRY_INSTRUCTION] : []),
  ];
  return [
    ...messages.slice(0, -1),
    ...lines.map((content) => ({ role: "system" as const, content })),
    messages[messages.length - 1],
  ];
}

interface Answer {
  content: string;
  model: string;
  usage: AiUsage | null;
}

type Generated = { kind: "answer"; answer: Answer } | { kind: AskCode };

/**
 * Up to two model calls. An unusable answer (empty, with placements that are
 * not in the facts, or with advice, predictions, scores or diagnoses the policy
 * filter rejects) is retried once; after that the fixed fallback is the answer. Usage is recorded for every call that spent tokens, with its attempt
 * number (the daily limit counts attempt 1 only).
 */
async function generate(
  provider: AiProvider,
  prepared: Prepared,
  ids: { threadId: string; userId: string; relationshipId: string | null },
): Promise<Generated> {
  let messages = prepared.messages;
  let lastUsage: AiUsage | null = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let result: { text: string; usage: AiUsage };
    try {
      result = await provider.chat(messages, CALL_OPTIONS);
    } catch (e) {
      if (e instanceof AiInvalidOutputError) {
        lastUsage = e.usage;
        await recordUsage({
          userId: ids.userId,
          relationshipId: ids.relationshipId,
          kind: "question",
          model: provider.model,
          promptVersion: ASSISTANT_PROMPT_VERSION,
          usage: e.usage,
          attempt,
        });
        logFailure(ids.threadId, `validate-${attempt}`, "invalid_output");
        continue;
      }
      const unavailable = e instanceof AiUnavailableError;
      logFailure(ids.threadId, "generate", unavailable ? e.reason : "unknown");
      return { kind: unavailable ? "ai_unavailable" : "error" };
    }
    lastUsage = result.usage;
    await recordUsage({
      userId: ids.userId,
      relationshipId: ids.relationshipId,
      kind: "question",
      model: provider.model,
      promptVersion: ASSISTANT_PROMPT_VERSION,
      usage: result.usage,
      attempt,
    });
    const text = result.text.trim().slice(0, MAX_CONTENT_LENGTH);
    const rejected = findUnsupportedClaims(text, prepared.claims);
    const unsupported = rejected.length > 0;
    const violations = findPolicyViolations(text, { names: prepared.names });
    if (!unsupported && violations.length === 0) {
      logFlags(ids.threadId, text, prepared.names);
      return {
        kind: "answer",
        answer: { content: text, model: provider.model, usage: result.usage },
      };
    }
    // Codes only: the answer's words and the matched text are never logged.
    if (unsupported)
      logFailure(ids.threadId, `validate-${attempt}`, "unsupported_claims");
    if (violations.length > 0)
      logFailure(
        ids.threadId,
        `validate-${attempt}`,
        `policy:${[...new Set(violations.map((v) => v.category))].join(",")}`,
      );
    messages = withRetryInstructions(prepared.messages, {
      unsupported: rejected,
      policy: violations.length > 0,
    });
  }
  return {
    kind: "answer",
    answer: {
      content: FALLBACK_ANSWER,
      model: provider.model,
      usage: lastUsage,
    },
  };
}

interface StoredTurn {
  role: string;
  content: string;
  model: string | null;
}

/**
 * Oldest first in, oldest first out, without any crisis exchange: the fixed
 * reply (model "safety") and the question right before it. They stay stored so
 * the person sees their conversation, but they are never sent to the model.
 */
function withoutCrisisExchanges(turns: StoredTurn[]): StoredTurn[] {
  const dropped = new Set<number>();
  turns.forEach((turn, i) => {
    if (turn.role !== "assistant" || turn.model !== "safety") return;
    dropped.add(i);
    if (i > 0 && turns[i - 1].role === "user") dropped.add(i - 1);
  });
  return turns.filter((_, i) => !dropped.has(i));
}

/**
 * Stores the question and its answer in one insert, so a failure cannot leave
 * a question without an answer, then touches the thread. The user message is
 * dated before the answer so it sorts first.
 */
async function storeExchange(input: {
  threadId: string;
  question: string;
  answer: Answer & { promptVersion: string };
  askedAt: number;
  title: string | null;
}): Promise<AskCode | null> {
  const { threadId, answer } = input;
  const answeredAt = Math.max(Date.now(), input.askedAt + 1);
  const admin = createAdminClient();

  const { error } = await admin.from("ai_messages").insert([
    {
      thread_id: threadId,
      role: "user",
      content: input.question,
      created_at: new Date(input.askedAt).toISOString(),
    },
    {
      thread_id: threadId,
      role: "assistant",
      content: answer.content,
      model: answer.model,
      prompt_version: answer.promptVersion,
      input_tokens: answer.usage?.inputTokens ?? null,
      output_tokens: answer.usage?.outputTokens ?? null,
      created_at: new Date(answeredAt).toISOString(),
    },
  ]);
  if (error) {
    logFailure(threadId, "store", dbCode(error));
    if (error.code === RELATIONSHIP_NOT_ACTIVE) return "not_connected";
    if (error.code === FOREIGN_KEY_VIOLATION) return "not_found";
    return "error";
  }

  const { error: touchError } = await admin
    .from("ai_threads")
    .update({
      updated_at: new Date(answeredAt).toISOString(),
      ...(input.title && { title: input.title }),
    })
    .eq("id", threadId);
  if (touchError) {
    logFailure(threadId, "touch", dbCode(touchError));
    if (touchError.code === RELATIONSHIP_NOT_ACTIVE) return "not_connected";
  }
  return null;
}

const fail = (code: AskCode): AskResult => ({ ok: false, code });

export async function askQuestion(
  threadId: string,
  question: string,
): Promise<AskResult> {
  // Outside any try: an unauthenticated request redirects to sign in.
  const userId = await requireUserId();
  const text = question.trim();
  if (text.length < 1 || text.length > MAX_QUESTION_LENGTH)
    return fail("error");
  const askedAt = Date.now();

  try {
    const supabase = await createClient();
    const { data: thread, error: threadError } = await supabase
      .from("ai_threads")
      .select(THREAD_COLUMNS)
      .eq("id", threadId)
      .maybeSingle();
    if (threadError) {
      logFailure(null, "thread", dbCode(threadError));
      return fail(
        threadError.code === INVALID_TEXT_REPRESENTATION
          ? "not_found"
          : "error",
      );
    }
    if (!thread) return fail("not_found");

    let context: RelationshipContext | null = null;
    if (thread.thread_type === "relationship") {
      context = await loadRelationshipContext();
      if (!context || context.relationshipId !== thread.relationship_id)
        return fail("not_connected");
    }
    const relationshipId = context?.relationshipId ?? null;
    const isFirstQuestion = DEFAULT_TITLES.includes(thread.title);
    const title = isFirstQuestion ? titleFromQuestion(text) : null;

    const category = classifyQuestion(text);
    if (category === "crisis") {
      // Before the limit and the provider: support must always be available.
      const code = await storeExchange({
        threadId,
        question: text,
        answer: {
          content: CRISIS_REPLY,
          model: "safety",
          usage: null,
          promptVersion: ASSISTANT_PROMPT_VERSION,
        },
        askedAt,
        title: null,
      });
      return code ? fail(code) : { ok: true };
    }

    const used = await countRecentUsage({ userId, kind: "question" });
    if (used >= getAiConfig().dailyQuestionLimit) return fail("limit");
    const provider = getAiProvider();

    const { data: recent, error: historyError } = await supabase
      .from("ai_messages")
      .select("role, content, model")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_FETCH_LIMIT);
    if (historyError) {
      logFailure(threadId, "history", dbCode(historyError));
      return fail("error");
    }
    const history: AiMessage[] = withoutCrisisExchanges(
      (recent ?? []).reverse(),
    )
      .slice(-HISTORY_LIMIT)
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      }));

    const sensitive = category === "sensitive";
    const prepared = context
      ? await prepareRelationship(context, history, text, sensitive)
      : await prepareChart(history, text, sensitive);
    if (typeof prepared === "string") return fail(prepared);

    const generated = await generate(provider, prepared, {
      threadId,
      userId,
      relationshipId,
    });
    if (generated.kind !== "answer") return fail(generated.kind);

    const code = await storeExchange({
      threadId,
      question: text,
      answer: { ...generated.answer, promptVersion: ASSISTANT_PROMPT_VERSION },
      askedAt,
      title,
    });
    if (code) return fail(code);
    // Crisis replies return earlier and never reach the model, so they are not counted.
    trackAfterResponse("ai_question_asked", userId);
    return { ok: true };
  } catch (e) {
    if (e instanceof AiUnavailableError) {
      logFailure(threadId, "provider", e.reason);
      return fail("ai_unavailable");
    }
    logFailure(threadId, "ask", "exception");
    return fail("error");
  }
}
