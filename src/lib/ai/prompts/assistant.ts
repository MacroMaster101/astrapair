import type { NatalFacts, RelationshipFacts } from "@/lib/ai/facts";
import { CRISIS_REPLY, SENSITIVE_INSTRUCTION } from "@/lib/ai/safety";
import type { AiMessage } from "@/lib/ai/types";
import { cleanText, sanitizeName } from "./names";

export const ASSISTANT_PROMPT_VERSION = "assistant-v1";

/**
 * Second safety layer behind `classifyQuestion`: a disclosure the keyword
 * check missed must still get the fixed supportive reply, not a reading.
 */
export const ASSISTANT_CRISIS_RULE = `Safety rule, which overrides everything else: if the user describes being harmed, hit, threatened, frightened or coerced by someone, or wanting to die or to hurt themselves, do not give an astrology reading and do not mention their chart. Reply with only this message, word for word: "${CRISIS_REPLY}"`;

export const ASSISTANT_SYSTEM_PROMPT = `You are AstraPair's astrology guide. Answer using only the chart facts provided below. Never calculate or invent placements, signs, aspects or houses; if the facts do not cover the question, say so. Explain that astrology is a traditional interpretive framework, not fact. Never diagnose medical or mental-health conditions, pregnancy, abuse, criminality or financial outcomes, and never tell someone to break up, marry or make major decisions; offer reflective questions instead. Never predict how a relationship will turn out, give scores or percentages, or tell anyone to start, stop or change a medication. Keep answers under 200 words, plain and kind. Use no em or en dashes.\n\n${ASSISTANT_CRISIS_RULE}`;

const HISTORY_LIMIT = 10;

/** A heading and bullet lines, or nothing when there are no lines. */
const block = (heading: string, lines: string[]) =>
  lines.length > 0 ? [heading, ...lines.map((l) => `- ${cleanText(l)}`)] : [];

function finish(
  system: string,
  input: { history: AiMessage[]; question: string; sensitive: boolean },
): AiMessage[] {
  const messages: AiMessage[] = [{ role: "system", content: system }];
  if (input.sensitive)
    messages.push({ role: "system", content: SENSITIVE_INSTRUCTION });
  // Only conversation turns; a stored or forged system message never gets through.
  const history = input.history.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );
  messages.push(...history.slice(-HISTORY_LIMIT), {
    role: "user",
    content: input.question,
  });
  return messages;
}

export function buildChartAssistantMessages(input: {
  name: string;
  facts: NatalFacts;
  history: AiMessage[];
  question: string;
  sensitive: boolean;
}): AiMessage[] {
  const name = sanitizeName(input.name, "You");
  const system = [
    ASSISTANT_SYSTEM_PROMPT,
    "",
    ...block(`Facts about ${name}'s chart:`, input.facts.lines),
    ...block("Notes:", input.facts.notes),
  ].join("\n");
  return finish(system, input);
}

/**
 * `relationship` must be oriented viewer = a, partner = b (`names.a` is the
 * viewer, `names.b` the partner). The partner is always side "b"; names are
 * only used for wording, never to pick a side.
 */
export function buildRelationshipAssistantMessages(input: {
  viewerName: string;
  partnerName: string;
  viewer: NatalFacts;
  relationship: RelationshipFacts;
  reportSummaries: string[] | null;
  history: AiMessage[];
  question: string;
  sensitive: boolean;
}): AiMessage[] {
  const { relationship } = input;
  const viewerName = sanitizeName(input.viewerName, "You");
  const partnerName = sanitizeName(input.partnerName, "Your partner");
  // Sign-level facts only for the partner; houses and degrees never leave their chart.
  const bigThree = relationship.people.b.bigThree;
  const bigThreeLine = bigThree
    ? [
        `Big Three: Sun in ${bigThree.sun}, Moon in ${bigThree.moon}` +
          (bigThree.ascendant.startsWith("Needs")
            ? ""
            : `, Ascendant in ${bigThree.ascendant}`),
      ]
    : [];
  const covered = bigThree ? ["sun", "moon", "ascendant"] : [];
  const partnerSigns = [
    ...bigThreeLine,
    ...relationship.evidence
      .filter(
        (e) =>
          e.id.startsWith("sign:b-") &&
          !covered.includes(e.id.slice("sign:b-".length)),
      )
      .map((e) => e.label),
  ];
  const synastry = relationship.evidence
    .filter((e) => e.id.startsWith("syn:") || e.id.startsWith("ovl:"))
    .map((e) => e.label);
  const system = [
    ASSISTANT_SYSTEM_PROMPT,
    "",
    ...block(`Facts about ${viewerName}'s chart:`, input.viewer.lines),
    ...block("Notes:", input.viewer.notes),
    ...block(`Signs in ${partnerName}'s chart:`, partnerSigns),
    ...block(
      `How ${viewerName}'s and ${partnerName}'s charts connect:`,
      synastry,
    ),
    ...block("Relationship notes:", relationship.notes),
    ...block(
      "Summaries of their compatibility report:",
      input.reportSummaries ?? [],
    ),
    "",
    `Never mention anything about ${partnerName} beyond these facts.`,
  ].join("\n");
  return finish(system, input);
}
