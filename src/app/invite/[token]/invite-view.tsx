import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { InviteResponse } from "./invite-response";
import type { InviteView } from "./invite-state";

export function InviteViewContent({
  view,
  token,
}: {
  view: Exclude<InviteView, { kind: "redirect" }>;
  token: string;
}) {
  if (view.kind === "notice") return <Notice {...view} />;

  if (view.kind === "respond") {
    return <InviteResponse token={token} inviterName={view.inviterName} />;
  }

  const { inviterName } = view;
  return (
    <div className="bg-card grid gap-6 rounded-3xl border p-6 sm:p-10">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {inviterName} invited you to connect on AstraPair
        </h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          AstraPair turns two birth charts into a compatibility reading. Create
          an account or sign in to see what {inviterName} would share and decide
          whether to connect.
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href={view.signUpHref}
          className={buttonVariants({ className: "h-10" })}
        >
          Create an account
        </Link>
        <Link
          href={view.signInHref}
          className={buttonVariants({ variant: "outline", className: "h-10" })}
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}

function Notice({
  title,
  body,
  href,
  label,
}: {
  title: string;
  body: string;
  href: string;
  label: string;
}) {
  return (
    <div className="bg-card grid gap-6 rounded-3xl border p-6 sm:p-10">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">{body}</p>
      </header>
      <Link
        href={href}
        className={buttonVariants({ variant: "outline", className: "h-10" })}
      >
        {label}
      </Link>
    </div>
  );
}
