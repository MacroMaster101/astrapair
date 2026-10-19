import type { ThreadMessage } from "@/lib/assistant/service";
import { cn } from "@/lib/utils";

/**
 * Questions and answers are text typed by a person or written by a model, so
 * they are only ever rendered as React text nodes, never as HTML.
 */
function paragraphs(content: string): string[] {
  return content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function Conversation({ messages }: { messages: ThreadMessage[] }) {
  // The live region is always in the page, so the first answer in a new thread
  // is announced too: a region added together with its content is not.
  return (
    <div role="log" aria-live="polite" aria-label="Conversation">
      {messages.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Ask your first question below.
        </p>
      ) : (
        <ol className="grid gap-4">
          {messages.map((message) => {
            const isUser = message.role === "user";
            return (
              <li
                key={message.id}
                className={cn("flex", isUser ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "grid max-w-[90%] gap-3 rounded-2xl px-4 py-3 text-sm leading-relaxed break-words sm:max-w-[80%]",
                    isUser ? "bg-muted" : "bg-card border",
                  )}
                >
                  <span className="sr-only">
                    {isUser ? "You asked:" : "AstraPair answered:"}
                  </span>
                  {isUser ? (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  ) : (
                    paragraphs(message.content).map((text, i) => (
                      <p key={i} className="whitespace-pre-wrap">
                        {text}
                      </p>
                    ))
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
