import type { RelationshipFacts } from "@/lib/ai/facts";
import { rejectedPlacementsNote, type UnsupportedClaim } from "@/lib/ai/guard";
import { POLICY_RETRY_INSTRUCTION } from "@/lib/ai/policy";
import type { AiMessage } from "@/lib/ai/types";
import { REPORT_SECTIONS } from "@/lib/ai/report-schema";
import { cleanText, sanitizeName } from "./names";

export const REPORT_PROMPT_VERSION = "report-v1";

export const REPORT_SYSTEM_PROMPT =
  "You write a compatibility reading for a couple using traditional astrology. Use only the facts provided. Never invent or change a placement, sign, aspect or house. Refer to people by name. Every section must cite the ids of the facts it relies on in `evidence`, choosing only ids from the list. Present astrology as a traditional interpretive framework, not as scientific fact. Do not predict the future, give probabilities or scores, or tell them to stay together, marry or break up. Never diagnose anyone or give medical, pregnancy, fertility or money advice. If a fact is uncertain because a birth time is unknown, say so where it matters. Write warmly and plainly, in second person plural when addressing the couple. Use no em or en dashes.";

const FORMAT_INSTRUCTIONS = [
  "The reading has nine sections. Use these keys under `sections`:",
  ...REPORT_SECTIONS.map((s) => `- ${s.key}: ${s.title}`),
  "Each section needs a `summary`, a `body` and `evidence`. `summary` is one sentence. `body` is 2 short paragraphs, about 80 to 140 words in total. `evidence` lists ids chosen only from the facts list, copied exactly.",
  "`reflectionQuestions` is a separate list of 3 to 6 short questions for the couple to think about together. Questions are not evidence.",
].join("\n");

/** Added on the second attempt, after an invalid or unsupported first one. */
export const REPORT_RETRY_INSTRUCTION =
  "Your previous reading mentioned placements that are not in the facts or was not valid. Write it again using only the facts and the required JSON shape.";

/**
 * The claims object holds Sets and is never serialised; only names, notes and
 * the evidence list go in. The sign facts are in the evidence, so there is no
 * separate people block, and the JSON is compact to save context.
 * `retry` adds the invalid-or-unsupported line and `policy` the advice-or-
 * predictions line, so a second attempt says only what went wrong. `rejected`
 * (the guard's findings) names the placements to drop, on the retry line only.
 */
export function buildReportMessages(
  facts: RelationshipFacts,
  opts: {
    retry?: boolean;
    policy?: boolean;
    rejected?: UnsupportedClaim[];
  } = {},
): AiMessage[] {
  const block = JSON.stringify({
    names: {
      a: sanitizeName(facts.names.a, "You"),
      b: sanitizeName(facts.names.b, "Your partner"),
    },
    notes: facts.notes,
    facts: facts.evidence.map(({ id, label }) => ({
      id,
      label: cleanText(label),
    })),
  });
  return [
    { role: "system", content: REPORT_SYSTEM_PROMPT },
    ...(opts.retry
      ? [
          {
            role: "system" as const,
            content:
              REPORT_RETRY_INSTRUCTION +
              rejectedPlacementsNote(opts.rejected ?? []),
          },
        ]
      : []),
    ...(opts.policy
      ? [{ role: "system" as const, content: POLICY_RETRY_INSTRUCTION }]
      : []),
    {
      role: "user",
      content: `${block}\n\n${FORMAT_INSTRUCTIONS}\n\nWrite the reading as JSON matching the schema.`,
    },
  ];
}
