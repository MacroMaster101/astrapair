import { z } from "zod";

export const REPORT_SECTIONS = [
  { key: "overview", title: "Relationship overview" },
  { key: "emotional", title: "Emotional dynamics" },
  { key: "communication", title: "Communication" },
  { key: "affection", title: "Affection and romance" },
  { key: "attraction", title: "Attraction" },
  { key: "conflict", title: "Conflict patterns" },
  { key: "strengths", title: "Strengths" },
  { key: "friction", title: "Potential friction" },
  { key: "growth", title: "Shared growth" },
] as const;

export type ReportSectionKey = (typeof REPORT_SECTIONS)[number]["key"];

export interface ReportSection {
  summary: string;
  body: string;
  evidence: string[];
}

export interface ReportInterpretation {
  sections: Record<ReportSectionKey, ReportSection>;
  reflectionQuestions: string[];
}

const LIMITS = {
  summary: { min: 10, max: 240 },
  body: { min: 80, max: 1800 },
  evidence: { max: 8, idMax: 64 },
  questions: { min: 3, max: 6 },
  question: { min: 10, max: 200 },
} as const;

const sectionSchema = z.strictObject({
  summary: z.string().min(LIMITS.summary.min).max(LIMITS.summary.max),
  body: z.string().min(LIMITS.body.min).max(LIMITS.body.max),
  evidence: z
    .array(z.string().max(LIMITS.evidence.idMax))
    .max(LIMITS.evidence.max),
});

const sectionsShape = Object.fromEntries(
  REPORT_SECTIONS.map((s) => [s.key, sectionSchema]),
) as Record<ReportSectionKey, typeof sectionSchema>;

export const reportInterpretationSchema: z.ZodType<ReportInterpretation> =
  z.strictObject({
    sections: z.strictObject(sectionsShape),
    reflectionQuestions: z
      .array(z.string().min(LIMITS.question.min).max(LIMITS.question.max))
      .min(LIMITS.questions.min)
      .max(LIMITS.questions.max),
  });

const sectionJsonSchema = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      minLength: LIMITS.summary.min,
      maxLength: LIMITS.summary.max,
    },
    body: {
      type: "string",
      minLength: LIMITS.body.min,
      maxLength: LIMITS.body.max,
    },
    evidence: {
      type: "array",
      items: { type: "string", maxLength: LIMITS.evidence.idMax },
      maxItems: LIMITS.evidence.max,
    },
  },
  required: ["summary", "body", "evidence"],
  additionalProperties: false,
};

/** Hand-written JSON Schema equivalent of `reportInterpretationSchema`, for Ollama `format`. */
export const REPORT_JSON_SCHEMA: object = {
  type: "object",
  properties: {
    sections: {
      type: "object",
      properties: Object.fromEntries(
        REPORT_SECTIONS.map((s) => [s.key, sectionJsonSchema]),
      ),
      required: REPORT_SECTIONS.map((s) => s.key),
      additionalProperties: false,
    },
    reflectionQuestions: {
      type: "array",
      items: {
        type: "string",
        minLength: LIMITS.question.min,
        maxLength: LIMITS.question.max,
      },
      minItems: LIMITS.questions.min,
      maxItems: LIMITS.questions.max,
    },
  },
  required: ["sections", "reflectionQuestions"],
  additionalProperties: false,
};

/** Validates the model's JSON, then drops unknown and repeated evidence ids. */
export function parseInterpretation(
  json: unknown,
  knownEvidenceIds: Set<string>,
): ReportInterpretation | null {
  const parsed = reportInterpretationSchema.safeParse(json);
  if (!parsed.success) return null;
  const sections = {} as Record<ReportSectionKey, ReportSection>;
  for (const { key } of REPORT_SECTIONS) {
    const section = parsed.data.sections[key];
    sections[key] = {
      ...section,
      evidence: [
        ...new Set(section.evidence.filter((id) => knownEvidenceIds.has(id))),
      ],
    };
  }
  return { sections, reflectionQuestions: parsed.data.reflectionQuestions };
}

/** Every piece of prose in the report, joined for the guard. */
export function interpretationText(i: ReportInterpretation): string {
  return [
    ...REPORT_SECTIONS.flatMap(({ key }) => [
      i.sections[key].summary,
      i.sections[key].body,
    ]),
    ...i.reflectionQuestions,
  ].join("\n");
}
