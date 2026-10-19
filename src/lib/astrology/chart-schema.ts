import { z } from "zod";
import {
  ASPECT_TYPES,
  BIRTH_TIME_ACCURACIES,
  BODIES,
  SIGNS,
  type NatalChart,
} from "./types";

const finite = z.number().finite();
const sign = z.enum(SIGNS);
const accuracy = z.enum(BIRTH_TIME_ACCURACIES);
const chartPoint = z.enum([...BODIES, "ascendant", "midheaven"]);

const birthInputSchema = z.object({
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  birthTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  accuracy,
  latitude: finite.min(-90).max(90),
  longitude: finite.min(-180).max(180),
  timezone: z.string().min(1),
});

const placementSchema = z.object({
  body: z.enum(BODIES),
  longitude: finite.min(0).max(360),
  sign,
  degree: finite.min(0).max(30),
  retrograde: z.boolean(),
  house: z.number().int().min(1).max(12).nullable(),
});

const angleSchema = z.object({
  longitude: finite.min(0).max(360),
  sign,
  degree: finite.min(0).max(30),
});

/** Runtime shape of a stored NatalChart; keep in step with `NatalChart`. */
export const natalChartSchema = z.object({
  schemaVersion: z.literal(1),
  engine: z.object({ name: z.string().min(1), version: z.string().min(1) }),
  zodiac: z.literal("tropical"),
  houseSystem: z.enum(["placidus", "porphyry"]).nullable(),
  utc: z.string().min(1),
  input: birthInputSchema,
  placements: z
    .array(placementSchema)
    .length(BODIES.length)
    .refine((list) => BODIES.every((b) => list.some((p) => p.body === b))),
  ascendant: angleSchema.nullable(),
  midheaven: angleSchema.nullable(),
  houses: z
    .array(
      z.object({
        house: z.number().int().min(1).max(12),
        longitude: finite.min(0).max(360),
        sign,
      }),
    )
    .length(12)
    .nullable(),
  aspects: z.array(
    z.object({
      a: chartPoint,
      b: chartPoint,
      type: z.enum(ASPECT_TYPES),
      orb: finite.min(0),
      applying: z.boolean().nullable(),
    }),
  ),
  uncertainty: z.object({
    timeAccuracy: accuracy,
    ascendantSigns: z.array(sign).optional(),
    moonSigns: z.array(sign).optional(),
    dstWarning: z.enum(["nonexistent", "ambiguous"]).optional(),
    houseFallback: z.literal("polar_latitude").optional(),
  }),
});

/**
 * Validates a chart read from the database. Returns null when the JSON is
 * malformed or was made by a different engine version, so callers recalculate.
 */
export function parseStoredChart(
  json: unknown,
  engineVersion: string,
): NatalChart | null {
  const parsed = natalChartSchema.safeParse(json);
  if (!parsed.success) return null;
  if (parsed.data.engine.version !== engineVersion) return null;
  return parsed.data as NatalChart;
}
