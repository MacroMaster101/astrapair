import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-16 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">AstraPair</h1>
      <p className="text-muted-foreground max-w-md text-lg">
        Birth charts, compatibility insights, and AI-guided relationship
        readings for couples.
      </p>
      <div className="flex gap-3">
        <Link href="/signup" className={buttonVariants()}>
          Get started
        </Link>
        <Link href="/login" className={buttonVariants({ variant: "outline" })}>
          Sign in
        </Link>
      </div>
      <p className="text-muted-foreground max-w-md text-sm">
        Astrology is offered for entertainment and self-reflection, not as
        professional advice.{" "}
        <Link href="/legal/disclaimer" className="underline underline-offset-4">
          Disclaimer
        </Link>
      </p>
    </main>
  );
}
