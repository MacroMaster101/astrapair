import { cancelInvite } from "@/app/(app)/partner/actions";
import { Button } from "@/components/ui/button";
import { formatDate } from "./format-date";

/**
 * Details of the invite that is waiting. It is rendered beside the invite
 * panel, never around it, so creating a new link cannot remount the panel and
 * hide the one-time link before it is copied.
 */
export function PendingInvite({ expiresAt }: { expiresAt: string }) {
  return (
    <section
      aria-labelledby="pending-invite"
      className="bg-card grid gap-4 rounded-2xl border p-6"
    >
      <div className="grid gap-1">
        <h2 id="pending-invite" className="text-lg font-semibold">
          Your invite is waiting
        </h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Expires {formatDate(expiresAt)}.
        </p>
        <p className="text-muted-foreground text-sm leading-relaxed">
          This link works once.
        </p>
        <p className="text-muted-foreground text-sm leading-relaxed">
          For your safety we can&apos;t show the link again. If you lost it,
          create a new one below.
        </p>
      </div>
      <form action={cancelInvite}>
        <Button type="submit" variant="outline" className="h-10 px-4">
          Cancel invite
        </Button>
      </form>
    </section>
  );
}
