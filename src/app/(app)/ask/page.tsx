import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { startThreadAction } from "@/app/(app)/ask/actions";
import { ThreadList } from "@/components/ask/thread-list";
import { FormError } from "@/components/form-field";
import { Disclaimer } from "@/components/report/disclaimer";
import { Button } from "@/components/ui/button";
import { getRemainingQuestions, listThreads } from "@/lib/assistant/service";
import { requireOnboardedUserId } from "@/lib/auth/session";
import { getPartnerOverview } from "@/lib/partner/service";

export const metadata: Metadata = { title: "Ask AstraPair · AstraPair" };

// Only these codes are ever shown; anything else in the URL is ignored.
const ERROR_MESSAGES: Record<string, string> = {
  not_connected: "You're not connected with a partner.",
  no_chart: "Add your birth details first.",
  error: "Something went wrong. Please try again.",
};

function errorMessage(code: string | string[] | undefined): string | undefined {
  if (typeof code !== "string") return undefined;
  return Object.hasOwn(ERROR_MESSAGES, code) ? ERROR_MESSAGES[code] : undefined;
}

function StarterForm({
  type,
  label,
  description,
}: {
  type: "chart" | "relationship";
  label: string;
  description: string;
}) {
  return (
    <form
      action={startThreadAction}
      className="bg-card grid content-between justify-items-start gap-4 rounded-2xl border p-6"
    >
      <input type="hidden" name="type" value={type} />
      <p className="text-muted-foreground text-sm leading-relaxed">
        {description}
      </p>
      <Button type="submit" className="h-10 px-4">
        {label}
      </Button>
    </form>
  );
}

export default async function AskPage({ searchParams }: PageProps<"/ask">) {
  await requireOnboardedUserId();
  const { error } = await searchParams;

  // A failed lookup only hides the relationship starter; the page still works.
  const [threads, remaining, partner] = await Promise.all([
    listThreads(),
    getRemainingQuestions(),
    getPartnerOverview().catch((e: unknown) => {
      unstable_rethrow(e);
      return null;
    }),
  ]);
  const connected = partner?.kind === "connected";
  const message = errorMessage(error);

  return (
    <div className="grid gap-8">
      <div className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Ask AstraPair</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Ask about your chart or your relationship and get an answer based on
          your placements.
        </p>
      </div>

      <section aria-labelledby="start-heading" className="grid gap-4">
        <h2 id="start-heading" className="text-lg font-semibold">
          Start a new question
        </h2>
        <FormError message={message} />
        <div className="grid gap-4 sm:grid-cols-2">
          <StarterForm
            type="chart"
            label="Ask about my chart"
            description="Questions about your own Sun, Moon, Ascendant and planets."
          />
          {connected && (
            <StarterForm
              type="relationship"
              label="Ask about us"
              description="Questions about how your chart and your partner's chart connect."
            />
          )}
        </div>
        <p className="text-muted-foreground text-sm">
          {remaining === 0
            ? "You have no questions left today. Come back tomorrow."
            : remaining === 1
              ? "You have 1 question left today."
              : `You have ${remaining} questions left today.`}
        </p>
      </section>

      <section aria-labelledby="threads-heading" className="grid gap-4">
        <h2 id="threads-heading" className="text-lg font-semibold">
          Your questions
        </h2>
        <ThreadList threads={threads} />
      </section>

      <Disclaimer />
    </div>
  );
}
