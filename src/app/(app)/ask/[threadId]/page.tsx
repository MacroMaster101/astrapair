import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Conversation } from "@/components/ask/conversation";
import { QuestionForm } from "@/components/ask/question-form";
import { Disclaimer } from "@/components/report/disclaimer";
import { getRemainingQuestions, getThread } from "@/lib/assistant/service";
import { requireOnboardedUserId } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Ask AstraPair · AstraPair" };

// A question makes up to two model calls of 50 s each (see CALL_OPTIONS in the assistant service).
export const maxDuration = 120;

export default async function ThreadPage({
  params,
}: PageProps<"/ask/[threadId]">) {
  await requireOnboardedUserId();
  const { threadId } = await params;

  const found = await getThread(threadId);
  if (!found) notFound();
  const remaining = await getRemainingQuestions();

  return (
    <div className="grid gap-8">
      <div className="grid justify-items-start gap-3">
        <Link
          href="/ask"
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          <span aria-hidden>&larr; </span>All questions
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-3xl">
          {found.thread.title}
        </h1>
      </div>

      <Conversation messages={found.messages} />

      <section aria-label="Ask a question" className="grid gap-3">
        <QuestionForm threadId={threadId} />
        <p className="text-muted-foreground text-sm">
          {remaining === 0
            ? "You have no questions left today. Come back tomorrow."
            : remaining === 1
              ? "You have 1 question left today."
              : `You have ${remaining} questions left today.`}
        </p>
      </section>

      <Disclaimer />
    </div>
  );
}
