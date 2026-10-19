import { Info } from "lucide-react";
import Link from "next/link";
import { BackLink } from "@/components/back-link";
import { formatDate } from "@/components/partner/format-date";
import { REPORT_SECTIONS } from "@/lib/ai/report-schema";
import type { StoredReport } from "@/lib/report/service";
import { Disclaimer } from "./disclaimer";
import { GenerateReportButton } from "./generate-report-button";
import { OUT_OF_DATE_NOTE } from "./report-card";

/** Paragraphs are separated by blank lines. Model text is only ever rendered as text. */
function paragraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function ReportView({
  report,
  outOfDate,
}: {
  report: StoredReport;
  outOfDate: boolean;
}) {
  const labels = new Map(report.evidence.map((e) => [e.id, e.label]));
  const { sections, reflectionQuestions } = report.interpretation;

  return (
    <article aria-labelledby="report-title" className="grid max-w-3xl gap-8">
      <BackLink href="/partner" className="w-fit">
        Back to your partner
      </BackLink>

      <header className="grid gap-2">
        <h1 id="report-title" className="text-3xl font-semibold tracking-tight">
          Your compatibility report
        </h1>
        <p className="text-lg">
          {report.names.a} and {report.names.b}
        </p>
        <p className="text-muted-foreground text-sm">
          Created {formatDate(report.completedAt)}
        </p>
        <p className="text-muted-foreground text-xs">
          Version {report.promptVersion} · model {report.model}
        </p>
      </header>

      {outOfDate && (
        <aside
          aria-label="Report status"
          className="bg-primary/5 flex gap-2 rounded-2xl border p-4 text-sm leading-relaxed"
        >
          <Info aria-hidden className="text-primary mt-0.5 size-4 shrink-0" />
          <p>
            This report may be out of date.{" "}
            <a
              href="#out-of-date-heading"
              className="text-primary font-medium underline-offset-4 hover:underline"
            >
              Refresh it below
            </a>
            .
          </p>
        </aside>
      )}

      {report.notes.length > 0 && (
        <aside
          aria-label="Notes about this report"
          className="bg-primary/5 grid gap-2 rounded-2xl border p-4"
        >
          {report.notes.map((note, i) => (
            <p key={i} className="flex gap-2 text-sm leading-relaxed">
              <Info
                aria-hidden
                className="text-primary mt-0.5 size-4 shrink-0"
              />
              {note}
            </p>
          ))}
        </aside>
      )}

      {REPORT_SECTIONS.map(({ key, title }) => {
        const section = sections[key];
        const headingId = `section-${key}`;
        const evidence = section.evidence.flatMap((id) => {
          const label = labels.get(id);
          return label ? [{ id, label }] : [];
        });
        return (
          <section
            key={key}
            aria-labelledby={headingId}
            className="bg-card grid gap-3 rounded-2xl border p-6"
          >
            <h2 id={headingId} className="text-xl font-semibold">
              {title}
            </h2>
            <p className="font-semibold">{section.summary}</p>
            {paragraphs(section.body).map((p, i) => (
              <p key={i} className="text-muted-foreground leading-relaxed">
                {p}
              </p>
            ))}
            {evidence.length > 0 && (
              <details className="group">
                <summary className="text-primary focus-visible:ring-ring/50 w-fit cursor-pointer rounded-md text-sm font-medium outline-none focus-visible:ring-3">
                  Chart evidence ({evidence.length})
                </summary>
                <ul className="text-muted-foreground mt-3 grid list-disc gap-1 pl-5 text-sm leading-relaxed">
                  {evidence.map((e) => (
                    <li key={e.id}>{e.label}</li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        );
      })}

      <section aria-labelledby="questions-heading" className="grid gap-3">
        <h2 id="questions-heading" className="text-xl font-semibold">
          Questions to reflect on
        </h2>
        <ol className="grid list-decimal gap-2 pl-5 leading-relaxed">
          {reflectionQuestions.map((q, i) => (
            <li key={i}>{q}</li>
          ))}
        </ol>
      </section>

      {outOfDate && (
        <section
          aria-labelledby="out-of-date-heading"
          className="bg-card grid justify-items-start gap-3 rounded-2xl border p-6"
        >
          <h2 id="out-of-date-heading" className="text-lg font-semibold">
            This report may be out of date
          </h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {OUT_OF_DATE_NOTE}
          </p>
          <GenerateReportButton label="Refresh report" variant="outline" />
        </section>
      )}

      <Disclaimer />
      <Link
        href="/partner"
        className="text-primary w-fit text-sm font-medium underline-offset-4 hover:underline"
      >
        Back to your partner
      </Link>
    </article>
  );
}
