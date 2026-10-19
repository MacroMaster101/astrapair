import { describe, expect, it } from "vitest";
import {
  REPORT_JSON_SCHEMA,
  REPORT_SECTIONS,
  interpretationText,
  parseInterpretation,
  reportInterpretationSchema,
  type ReportInterpretation,
} from "./report-schema";

const section = (over: Record<string, unknown> = {}) => ({
  summary: "A steady and warm pairing overall.",
  body: "You bring out a calm side in each other. ".repeat(3).trim(),
  evidence: ["syn:sun-trine-moon"],
  ...over,
});

const valid = (): ReportInterpretation => ({
  sections: Object.fromEntries(
    REPORT_SECTIONS.map((s) => [s.key, section()]),
  ) as ReportInterpretation["sections"],
  reflectionQuestions: [
    "What helps you both feel heard?",
    "Where could you slow down together?",
    "What do you each need after a hard day?",
  ],
});

describe("reportInterpretationSchema", () => {
  it("accepts a valid interpretation", () => {
    expect(reportInterpretationSchema.safeParse(valid()).success).toBe(true);
  });

  it("rejects a missing section", () => {
    const bad = valid() as unknown as {
      sections: Record<string, unknown>;
    };
    delete bad.sections.conflict;
    expect(reportInterpretationSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a body that is too short or a summary that is too long", () => {
    const short = valid();
    short.sections.overview = section({ body: "Too short." });
    expect(reportInterpretationSchema.safeParse(short).success).toBe(false);
    const long = valid();
    long.sections.overview = section({ summary: "x".repeat(241) });
    expect(reportInterpretationSchema.safeParse(long).success).toBe(false);
  });

  it("rejects more than eight evidence ids", () => {
    const bad = valid();
    bad.sections.overview = section({
      evidence: Array.from({ length: 9 }, (_, i) => `id-${i}`),
    });
    expect(reportInterpretationSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects unknown keys, like additionalProperties false", () => {
    expect(
      reportInterpretationSchema.safeParse({ ...valid(), extra: 1 }).success,
    ).toBe(false);
    const bad = valid();
    bad.sections.overview = section({ extra: "x" });
    expect(reportInterpretationSchema.safeParse(bad).success).toBe(false);
    const extraSection = valid() as unknown as {
      sections: Record<string, unknown>;
    };
    extraSection.sections.bonus = section();
    expect(reportInterpretationSchema.safeParse(extraSection).success).toBe(
      false,
    );
  });

  it("rejects evidence ids longer than 64 characters", () => {
    const bad = valid();
    bad.sections.overview = section({ evidence: ["x".repeat(65)] });
    expect(reportInterpretationSchema.safeParse(bad).success).toBe(false);
  });

  it("requires three to six reflection questions", () => {
    const two = {
      ...valid(),
      reflectionQuestions: ["One question here?", "Two questions here?"],
    };
    expect(reportInterpretationSchema.safeParse(two).success).toBe(false);
    const seven = {
      ...valid(),
      reflectionQuestions: Array.from({ length: 7 }, () => "A fine question?"),
    };
    expect(reportInterpretationSchema.safeParse(seven).success).toBe(false);
    const short = {
      ...valid(),
      reflectionQuestions: ["Why?", "How?", "When?"],
    };
    expect(reportInterpretationSchema.safeParse(short).success).toBe(false);
  });
});

describe("parseInterpretation", () => {
  it("drops unknown evidence ids and duplicates", () => {
    const input = valid();
    input.sections.overview = section({
      evidence: [
        "syn:sun-trine-moon",
        "made-up",
        "syn:sun-trine-moon",
        "sign:a-venus",
      ],
    });
    const parsed = parseInterpretation(
      input,
      new Set(["syn:sun-trine-moon", "sign:a-venus"]),
    );
    expect(parsed?.sections.overview.evidence).toEqual([
      "syn:sun-trine-moon",
      "sign:a-venus",
    ]);
    expect(parsed?.sections.growth.evidence).toEqual(["syn:sun-trine-moon"]);
  });

  it("returns null for invalid json", () => {
    expect(parseInterpretation({ sections: {} }, new Set())).toBeNull();
    expect(parseInterpretation("nope", new Set())).toBeNull();
    expect(parseInterpretation(null, new Set())).toBeNull();
  });
});

describe("interpretationText", () => {
  it("joins summaries, bodies and questions", () => {
    const input = valid();
    input.sections.growth = section({ summary: "Growth summary text." });
    const text = interpretationText(input);
    expect(text).toContain("Growth summary text.");
    expect(text).toContain(input.sections.overview.body);
    for (const q of input.reflectionQuestions) expect(text).toContain(q);
    expect(text).not.toContain("syn:sun-trine-moon");
  });
});

describe("REPORT_JSON_SCHEMA", () => {
  const schema = REPORT_JSON_SCHEMA as {
    type: string;
    required: string[];
    additionalProperties: boolean;
    properties: {
      sections: {
        required: string[];
        additionalProperties: boolean;
        properties: Record<
          string,
          {
            required: string[];
            additionalProperties: boolean;
            properties: Record<string, Record<string, unknown>>;
          }
        >;
      };
      reflectionQuestions: Record<string, unknown>;
    };
  };

  it("lists every section key as required and closes every object", () => {
    const keys = REPORT_SECTIONS.map((s) => s.key);
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["sections", "reflectionQuestions"]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.sections.required).toEqual(keys);
    expect(schema.properties.sections.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties.sections.properties)).toEqual(keys);
    for (const key of keys) {
      const s = schema.properties.sections.properties[key];
      expect(s.required).toEqual(["summary", "body", "evidence"]);
      expect(s.additionalProperties).toBe(false);
    }
  });

  it("carries the same limits as the zod schema", () => {
    const s = schema.properties.sections.properties.overview.properties;
    expect(s.summary).toMatchObject({ minLength: 10, maxLength: 240 });
    expect(s.body).toMatchObject({ minLength: 80, maxLength: 1800 });
    expect(s.evidence).toMatchObject({
      maxItems: 8,
      items: { maxLength: 64 },
    });
    expect(schema.properties.reflectionQuestions).toMatchObject({
      minItems: 3,
      maxItems: 6,
      items: { minLength: 10, maxLength: 200 },
    });
  });

  it("is plain JSON", () => {
    expect(JSON.parse(JSON.stringify(REPORT_JSON_SCHEMA))).toEqual(
      REPORT_JSON_SCHEMA,
    );
  });
});
