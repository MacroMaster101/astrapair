import Link from "next/link";
import { formatDate } from "@/components/partner/format-date";
import type { ThreadSummary } from "@/lib/assistant/service";

const TYPE_LABELS: Record<ThreadSummary["type"], string> = {
  chart: "Your chart",
  relationship: "Your relationship",
};

export function ThreadList({ threads }: { threads: ThreadSummary[] }) {
  if (threads.length === 0) {
    return <p className="text-muted-foreground text-sm">No questions yet.</p>;
  }

  return (
    <ul className="grid gap-2">
      {threads.map((thread) => (
        <li key={thread.id}>
          <Link
            href={`/ask/${thread.id}`}
            className="bg-card hover:bg-muted focus-visible:ring-ring/50 grid gap-1 rounded-xl border p-4 transition-colors outline-none focus-visible:ring-3"
          >
            <span className="font-medium break-words">{thread.title}</span>
            <span className="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
              <span>{TYPE_LABELS[thread.type]}</span>
              <span aria-hidden>·</span>
              <span>{formatDate(thread.updatedAt)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
