"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { askQuestionAction } from "@/app/(app)/ask/actions";
import { FormError } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/auth/validation";

const MAX_LENGTH = 500;

export function QuestionForm({ threadId }: { threadId: string }) {
  const [state, action, pending] = useActionState(
    askQuestionAction,
    {} as FormState,
  );
  const [question, setQuestion] = useState("");
  const [seenState, setSeenState] = useState(state);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  const counterId = useId();
  const errorId = useId();

  // A new result either clears the question (sent) or puts back what was typed
  // (error), because React resets the form after every action.
  if (state !== seenState) {
    setSeenState(state);
    if (state.message) setQuestion("");
    else if (state.values?.question !== undefined)
      setQuestion(state.values.question);
  }

  const fieldError = state.fieldErrors?.question?.[0];
  const errorMessage = state.error ?? fieldError;

  // The submit button is disabled while waiting, which drops focus: put it back
  // on the question after an answer and after an error.
  const finished = Boolean(state.message || errorMessage);
  useEffect(() => {
    if (finished) textarea.current?.focus();
  }, [state, finished]);

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="threadId" value={threadId} />
      <div className="grid gap-2">
        <Label htmlFor={fieldId}>Your question</Label>
        <textarea
          ref={textarea}
          id={fieldId}
          name="question"
          rows={3}
          maxLength={MAX_LENGTH}
          value={question}
          readOnly={pending}
          onChange={(event) => setQuestion(event.target.value)}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={
            [counterId, errorMessage && errorId].filter(Boolean).join(" ") ||
            undefined
          }
          className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 min-h-24 w-full resize-y rounded-lg border bg-transparent px-2.5 py-2 text-base transition-colors outline-none focus-visible:ring-3 aria-invalid:ring-3 md:text-sm"
        />
        <p id={counterId} className="text-muted-foreground text-xs">
          {question.length}/{MAX_LENGTH}
        </p>
      </div>
      <div id={errorId}>
        <FormError message={errorMessage} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="h-10 px-4"
        >
          {pending ? "Thinking..." : "Ask"}
        </Button>
        <p role="status" className="text-muted-foreground text-sm empty:hidden">
          {pending ? "Thinking. This can take up to a minute." : null}
        </p>
      </div>
    </form>
  );
}
