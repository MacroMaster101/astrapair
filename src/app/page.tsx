import {
  ArrowDownRight,
  ArrowRight,
  CalendarDays,
  Fingerprint,
  HeartHandshake,
  LockKeyhole,
  MessagesSquare,
  Orbit,
  Plus,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { ReadingExplorer } from "@/components/marketing/reading-explorer";
import { CelestialScene } from "@/components/marketing/celestial-scene";
import { MotionLink } from "@/components/marketing/motion-link";
import { OrbitAnimation } from "@/components/marketing/orbit-animation";
import { Reveal } from "@/components/marketing/reveal";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";

const STEPS = [
  {
    icon: CalendarDays,
    title: "Add your birth details",
    body: "Your birth date, place, and time create your chart. Unsure of the time? We show you which placements it affects.",
  },
  {
    icon: UserPlus,
    title: "Invite your partner",
    body: "Send a private link. Your charts connect only after your partner reviews what's shared and accepts.",
  },
  {
    icon: MessagesSquare,
    title: "Explore your reading together",
    body: "Discover how you communicate and connect. Ask follow-up questions grounded in both of your charts.",
  },
];

const QUESTIONS = [
  {
    question: "Do I need to know my exact birth time?",
    answer:
      "No. You can create a chart without it. AstraPair explains which placements are uncertain, including your Ascendant and houses, so your reading stays clear about what we know.",
  },
  {
    question: "Can I explore my chart without a partner?",
    answer:
      "Yes. Start with your own birth chart and ask the assistant about your placements. You can invite a partner whenever you're ready.",
  },
  {
    question: "What will my partner be able to see?",
    answer:
      "After you both accept the connection, your partner can see your display name, signs, and compatibility facts. Your birth date, birth time, birthplace, login details, and private assistant conversations stay private.",
  },
  {
    question: "Is this a prediction about our relationship?",
    answer:
      "No. AstraPair uses traditional Western astrology as a starting point for entertainment and self-reflection. Your reading isn't a scientific prediction or professional relationship advice.",
  },
];

export default async function Home({ searchParams }: PageProps<"/">) {
  const { account } = await searchParams;

  return (
    <div className="marketing-page flex flex-1 flex-col">
      <SiteHeader />
      <main id="main-content">
        {account === "deleted" && (
          <div className="site-container pt-6">
            <p
              role="status"
              className="bg-card text-card-foreground rounded-xl border px-4 py-3 text-sm"
            >
              Your account has been deleted.
            </p>
          </div>
        )}
        <section className="celestial-hero">
          <div className="site-container hero-grid">
            <Reveal className="hero-copy">
              <p className="eyebrow">
                <Orbit aria-hidden size={15} /> ASTROLOGY FOR CONNECTION
              </p>
              <h1>
                You, me &amp;
                <br />
                <span>the universe.</span>
              </h1>
              <p className="hero-description">
                Two birth charts. A fresh perspective on what brings you
                together.
              </p>
              <div className="hero-actions">
                <MotionLink href="/signup">
                  <span>Explore your connection</span>
                  <ArrowRight aria-hidden size={17} />
                </MotionLink>
                <a href="#how-it-works" className="text-link">
                  <span>How it works</span>
                  <ArrowDownRight aria-hidden size={16} />
                </a>
              </div>
            </Reveal>
            <CelestialScene />
          </div>
        </section>

        <div className="site-container">
          <div className="principle-strip">
            <div>
              <Orbit aria-hidden />
              <span>Rooted in your real birth charts</span>
            </div>
            <div>
              <HeartHandshake aria-hidden />
              <span>Made for the two of you</span>
            </div>
            <div>
              <LockKeyhole aria-hidden />
              <span>Private, by mutual consent</span>
            </div>
          </div>
        </div>

        <section id="reading" className="site-container section-space">
          <Reveal className="section-heading">
            <p className="eyebrow">MORE THAN A MATCH</p>
            <h2>
              There’s more to you
              <br />
              than your sun signs.
            </h2>
            <p>
              A little understanding changes the conversation. Explore the
              patterns behind how you love, listen, and find your way back.
            </p>
          </Reveal>
          <ReadingExplorer />
        </section>

        <section id="how-it-works" className="journey-section section-space">
          <div className="site-container journey-grid">
            <Reveal className="journey-heading">
              <h2>
                Two charts.
                <br />
                One shared perspective.
              </h2>
              <p>
                From the moment you were born to the connection you’re building
                now.
              </p>
              <OrbitAnimation />
            </Reveal>
            <ol className="journey-steps">
              {STEPS.map((step, index) => (
                <Reveal as="li" key={step.title} delay={index * 0.07}>
                  <span className="step-icon">
                    <step.icon aria-hidden size={23} strokeWidth={1.5} />
                  </span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </div>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        <section id="privacy" className="site-container section-space">
          <Reveal className="privacy-grid">
            <div className="privacy-symbol">
              <Fingerprint aria-hidden size={110} strokeWidth={0.8} />
              <span>
                Your connection.
                <br />
                Your choice.
              </span>
            </div>
            <div className="privacy-copy">
              <h2>
                A little cosmic insight.
                <br />A lot of personal space.
              </h2>
              <p>
                Nothing is shared until you both say yes. Either of you can
                disconnect at any time.
              </p>
              <div className="privacy-points">
                <div>
                  <ShieldCheck aria-hidden size={20} />
                  <div>
                    <h3>Only what you agree to share</h3>
                    <p>
                      Your signs and compatibility facts, never your exact birth
                      details.
                    </p>
                  </div>
                </div>
                <div>
                  <LockKeyhole aria-hidden size={20} />
                  <div>
                    <h3>Your conversations stay yours</h3>
                    <p>
                      Your private questions and assistant conversations stay
                      private.
                    </p>
                  </div>
                </div>
              </div>
              <Link href="/legal/privacy" className="text-link">
                <span>Read our privacy policy</span>
                <ArrowRight aria-hidden size={16} />
              </Link>
            </div>
          </Reveal>
        </section>

        <section className="site-container faq-section section-space">
          <Reveal className="faq-grid">
            <div>
              <h2>
                A few things
                <br />
                you might wonder.
              </h2>
              <p>Before you look to the stars.</p>
            </div>
            <div className="faq-list">
              {QUESTIONS.map((item) => (
                <details key={item.question}>
                  <summary>
                    <span>{item.question}</span>
                    <Plus
                      aria-hidden
                      size={18}
                      strokeWidth={1.5}
                      className="faq-plus"
                    />
                  </summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </Reveal>
        </section>

        <section className="site-container closing-section">
          <Reveal className="closing-inner">
            <Image
              src="/brand/astrapair-mark.webp"
              alt=""
              width={46}
              height={46}
            />
            <h2>A new way to see each other.</h2>
            <p>Start with your chart. See where the conversation takes you.</p>
            <MotionLink href="/signup">
              <span>Create your account</span>
              <ArrowRight aria-hidden size={17} />
            </MotionLink>
          </Reveal>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
