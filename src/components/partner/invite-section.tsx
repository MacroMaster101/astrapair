import { InvitePanel } from "./invite-panel";
import { PendingInvite } from "./pending-invite";

/**
 * The invite panel keeps the same position whether or not an invite is
 * pending, so React keeps its state (and the one-time link) when a new link is
 * created and the page refreshes. Do not wrap it or move it into the condition.
 */
export function InviteSection({
  pendingInvite,
}: {
  pendingInvite: { expiresAt: string } | null;
}) {
  return (
    <div className="grid gap-6">
      {pendingInvite && <PendingInvite expiresAt={pendingInvite.expiresAt} />}
      <InvitePanel
        title={pendingInvite ? "Create a new link" : "Invite your partner"}
        note={
          pendingInvite ? "Creating a new link cancels the old one." : undefined
        }
        hasPendingInvite={pendingInvite !== null}
      />
    </div>
  );
}
