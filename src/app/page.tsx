import {
  ArrowRight,
  CalendarClock,
  Check,
  CircleHelp,
  Flame,
  Handshake,
  MessageCircleHeart,
  MessagesSquare,
  MoonStar,
  UserPlus,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { OrbitVisual } from "@/components/marketing/orbit-visual";
import { pillButton } from "@/components/marketing/pill-button";
import { Reveal } from "@/components/marketing/reveal";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    icon: CalendarClock,
    title: "Add your birth details",
    body: "Date, place, and time if you know it. Unsure of the time? We show exactly which parts of your chart it affects.",
  },
  {
    icon: UserPlus,
    title: "Invite your partner",
    body: "Send a private link. Their chart is only compared with yours after they review what is shared and accept.",
  },
  {
    icon: MessagesSquare,
    title: "Read together, then ask",
    body: "Explore how you communicate, connect, and clash. Ask follow-up questions answered from your actual charts.",
  },
];

const READING_SECTIONS = [
  {
    icon: MessageCircleHeart,
    title: "Communication",
    body: "How each of you talks, listens, and settles disagreements, drawn from Mercury and the aspects between your charts.",
    className:
      "md:col-span-4 border-transparent bg-linear-to-br from-[#0949eb] to-[#973ff9] text-white",
    featured: true,
  },
  {
    icon: MoonStar,
    title: "Emotional needs",
    body: "What helps each of you feel safe and understood, read from your Moon placements.",
    className: "md:col-span-2 bg-card border-border",
  },
  {
    icon: Flame,
    title: "Attraction",
    body: "Where the spark comes from, through Venus and Mars across both charts.",
    className: "md:col-span-2 bg-card border-border",
  },
  {
    icon: Handshake,
    title: "Conflict and repair",
    body: "The friction worth knowing about, and how you each tend to come back together.",
    className: "md:col-span-2 bg-card border-border",
  },
  {
    icon: CircleHelp,
    title: "Questions for each other",
    body: "Every reading ends with prompts to talk through, so it turns into a conversation.",
    className: "md:col-span-2 bg-brand-violet/10 border-brand-violet/25",
  },
];

const SHARED = ["Your compatibility reading", "The chart factors behind it"];
const NEVER_SHARED = [
  "Your login details",
  "Your private AI conversations",
  "Anything outside this connection",
];

export default function Home() {
  return (
    <div className="bg-background text-foreground flex flex-1 flex-col">
      <SiteHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="starfield absolute inset-0 opacity-80 [mask-image:linear-gradient(to_bottom,black_60%,transparent)]"
          />
          <div className="relative mx-auto grid min-h-[calc(100dvh-4rem)] w-full max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:py-20">
            <Reveal className="grid gap-6">
              <h1 className="text-4xl leading-[1.05] font-semibold tracking-tighter text-balance md:text-5xl lg:text-6xl">
                Two birth charts.{" "}
                <span className="text-muted-foreground">
                  One conversation worth having.
                </span>
              </h1>
              <p className="text-muted-foreground max-w-[46ch] text-lg leading-relaxed">
                Compare your charts, read a compatibility report written for
                both of you, and ask questions grounded in your real placements.
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <Link
                  href="/signup"
                  className={pillButton("primary", "h-11 px-6")}
                >
                  Get started
                  <ArrowRight aria-hidden className="size-4" />
                </Link>
                <a
                  href="#how-it-works"
                  className={pillButton("ghost", "h-11 px-6")}
                >
                  How it works
                </a>
              </div>
            </Reveal>
            <OrbitVisual className="mx-auto max-w-xs sm:max-w-sm lg:max-w-md" />
          </div>
        </section>

        {/* How it works */}
        <section
          id="how-it-works"
          className="mx-auto grid w-full max-w-6xl scroll-mt-20 gap-12 px-4 py-20 sm:px-6 md:py-28 lg:grid-cols-[0.8fr_1.2fr]"
        >
          <Reveal className="grid content-start gap-4 lg:sticky lg:top-28">
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
              From birth details to a shared reading.
            </h2>
            <p className="text-muted-foreground max-w-[40ch] leading-relaxed">
              Your chart is calculated from real astronomical positions, then
              interpreted for the two of you.
            </p>
          </Reveal>
          <ol className="relative grid gap-10 before:absolute before:top-2 before:bottom-2 before:left-5 before:w-px before:bg-linear-to-b before:from-primary/60 before:via-brand-violet/40 before:to-transparent">
            {STEPS.map((step, i) => (
              <Reveal
                key={step.title}
                as="li"
                delay={i * 0.08}
                className="relative grid grid-cols-[2.5rem_1fr] gap-5"
              >
                <span className="bg-card relative flex size-10 items-center justify-center rounded-full border border-border">
                  <step.icon aria-hidden className="text-primary size-5" />
                </span>
                <div className="grid gap-2 pt-1.5">
                  <h3 className="text-lg font-semibold">{step.title}</h3>
                  <p className="text-muted-foreground max-w-[52ch] leading-relaxed">
                    {step.body}
                  </p>
                </div>
              </Reveal>
            ))}
          </ol>
        </section>

        {/* Reading bento */}
        <section
          id="reading"
          className="mx-auto grid w-full max-w-6xl scroll-mt-20 gap-10 px-4 py-20 sm:px-6 md:py-28"
        >
          <Reveal className="grid max-w-2xl gap-4">
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
              What your reading covers.
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              Each section shows the chart factors behind it, so you can see
              why, not just what.
            </p>
          </Reveal>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
            {READING_SECTIONS.map((item, i) => (
              <Reveal
                key={item.title}
                delay={i * 0.05}
                className={cn(
                  "col-span-1 rounded-3xl border p-6 md:p-8",
                  item.className,
                )}
              >
                <div
                  className={cn(
                    "flex h-full flex-col gap-3",
                    item.featured && "md:min-h-56 md:justify-end",
                  )}
                >
                  <item.icon
                    aria-hidden
                    className={cn(
                      "size-6",
                      item.featured ? "text-white" : "text-primary",
                    )}
                  />
                  <h3
                    className={cn(
                      "font-semibold",
                      item.featured ? "text-2xl" : "text-lg",
                    )}
                  >
                    {item.title}
                  </h3>
                  <p
                    className={cn(
                      "leading-relaxed",
                      item.featured
                        ? "max-w-[46ch] text-white/90"
                        : "text-muted-foreground",
                    )}
                  >
                    {item.body}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Privacy */}
        <section
          id="privacy"
          className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6 md:py-28"
        >
          <Reveal className="bg-card grid gap-10 rounded-3xl border border-border p-6 sm:p-10 md:p-14">
            <div className="grid max-w-2xl gap-4">
              <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
                Nothing is shared until you both say yes.
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                Your birth details stay yours. Connecting is a two-way
                agreement, and either of you can disconnect at any time.
              </p>
            </div>
            <div className="grid gap-8 sm:grid-cols-2">
              <ShareList title="Your partner can see" items={SHARED} shared />
              <ShareList title="Never shared" items={NEVER_SHARED} />
            </div>
          </Reveal>
        </section>

        {/* Closing CTA */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="starfield absolute inset-0 opacity-60 [mask-image:linear-gradient(to_top,black_50%,transparent)]"
          />
          <Reveal className="relative mx-auto grid w-full max-w-3xl justify-items-center gap-6 px-4 py-24 text-center sm:px-6 md:py-32">
            <Image
              src="/brand/astrapair-mark.webp"
              alt=""
              width={72}
              height={72}
              className="drop-shadow-[0_8px_30px_rgb(90_70_255/0.5)]"
            />
            <h2 className="text-3xl font-semibold tracking-tight md:text-5xl">
              Start with your own chart.
            </h2>
            <p className="text-muted-foreground max-w-[44ch] leading-relaxed">
              Create your account and add your birth details. Invite your
              partner whenever you are ready.
            </p>
            <Link href="/signup" className={pillButton("primary", "h-11 px-6")}>
              Get started
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </Reveal>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function ShareList({
  title,
  items,
  shared = false,
}: {
  title: string;
  items: string[];
  shared?: boolean;
}) {
  const Icon = shared ? Check : X;
  return (
    <div className="grid content-start gap-4">
      <h3 className="text-muted-foreground text-sm font-semibold">{title}</h3>
      <ul className="grid gap-3">
        {items.map((item) => (
          <li key={item} className="flex items-center gap-3">
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full",
                shared
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <Icon aria-hidden className="size-3.5" />
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
