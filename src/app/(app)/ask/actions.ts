"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAiConfig } from "@/lib/ai/config";
import { requireOnboardedUserId } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/validation";
import { createThread, askQuestion } from "@/lib/assistant/service";
import { createRateLimiter } from "@/lib/rate-limit";

const askLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

const GENERIC_ERROR = "Something went wrong. Please try again.";
const RATE_LIMIT_MESSAGE =
  "You're asking quickly. Wait a minute and try again.";
const QUESTION_MESSAGE = "Ask a question of up to 500 characters.";

const startThreadSchema = z.object({
  type: z.enum(["chart", "relationship"]),
});

const askSchema = z.object({
  threadId: z.uuid(),
  question: z
    .string()
    .trim()
    .min(1, QUESTION_MESSAGE)
    .max(500, QUESTION_MESSAGE),
});

export async function startThreadAction(formData: FormData): Promise<void> {
  await requireOnboardedUserId();

  const parsed = startThreadSchema.safeParse({
    type: String(formData.get("type") ?? ""),
  });
  if (!parsed.success) redirect("/ask?error=error");

  const result = await createThread(parsed.data.type);
  if (!result.ok) redirect(`/ask?error=${result.code}`);
  redirect(`/ask/${result.threadId}`);
}

export async function askQuestionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await requireOnboardedUserId();

  const question = String(formData.get("question") ?? "");
  const parsed = askSchema.safeParse({
    threadId: String(formData.get("threadId") ?? ""),
    question,
  });
  if (!parsed.success) {
    const { fieldErrors } = z.flattenError(parsed.error);
    if (fieldErrors.threadId)
      return { error: "We couldn't find that conversation." };
    return {
      fieldErrors: { question: [QUESTION_MESSAGE] },
      values: { question },
    };
  }
  if (!askLimiter.check(userId)) {
    return { error: RATE_LIMIT_MESSAGE, values: { question } };
  }

  const { threadId } = parsed.data;
  const result = await askQuestion(threadId, parsed.data.question);
  if (!result.ok) {
    return { error: askErrorMessage(result.code), values: { question } };
  }

  revalidatePath(`/ask/${threadId}`);
  return { message: "sent" };
}

function askErrorMessage(
  code: Extract<Awaited<ReturnType<typeof askQuestion>>, { ok: false }>["code"],
): string {
  switch (code) {
    case "limit":
      return `You've reached today's limit of ${getAiConfig().dailyQuestionLimit} questions. Try again tomorrow.`;
    case "ai_unavailable":
      return "The AI assistant is offline right now. Try again later.";
    case "not_connected":
      return "This conversation ended when you disconnected from your partner.";
    case "not_found":
      return "We couldn't find that conversation.";
    case "no_chart":
      return "Add your birth details first.";
    case "error":
      return GENERIC_ERROR;
  }
}
