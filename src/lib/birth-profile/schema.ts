import { z } from "zod";
import { isValidTimezone } from "@/lib/astrology/time";
import { BIRTH_TIME_ACCURACIES, type BirthInput } from "@/lib/astrology/types";
import { displayNameSchema } from "@/lib/auth/validation";

export const BIRTH_DETAIL_FIELDS = [
  "displayName",
  "birthDate",
  "accuracy",
  "birthTime",
  "placeLabel",
  "latitude",
  "longitude",
  "timezone",
] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const PLACE_MESSAGE = "Choose your birthplace from the list.";

export const isoToday = () => new Date().toISOString().slice(0, 10);

function isRealDate(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

const coordinate = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(1, PLACE_MESSAGE)
    .transform(Number)
    .pipe(
      z.number(PLACE_MESSAGE).min(min, PLACE_MESSAGE).max(max, PLACE_MESSAGE),
    );

export interface BirthProfileData {
  displayName: string;
  placeLabel: string;
  input: BirthInput;
}

export const birthProfileSchema = z
  .object({
    displayName: displayNameSchema,
    birthDate: z
      .string()
      .regex(DATE_RE, "Enter a valid date.")
      .refine(isRealDate, "Enter a valid date.")
      .refine(
        (d) => d >= "1900-01-01",
        "Birth dates before 1900 aren't supported.",
      )
      .refine((d) => d <= isoToday(), "Birth date can't be in the future."),
    accuracy: z.enum(
      BIRTH_TIME_ACCURACIES,
      "Choose how sure you are of the time.",
    ),
    birthTime: z.string().trim().optional(),
    placeLabel: z.string().trim().min(1, PLACE_MESSAGE).max(200),
    latitude: coordinate(-90, 90),
    longitude: coordinate(-180, 180),
    timezone: z.string().refine(isValidTimezone, PLACE_MESSAGE),
  })
  .superRefine((v, ctx) => {
    if (v.accuracy !== "unknown" && !TIME_RE.test(v.birthTime ?? "")) {
      ctx.addIssue({
        code: "custom",
        path: ["birthTime"],
        message: 'Enter your birth time, or choose "I don\'t know".',
      });
    }
  })
  .transform((v): BirthProfileData => ({
    displayName: v.displayName,
    placeLabel: v.placeLabel,
    input: {
      birthDate: v.birthDate,
      birthTime: v.accuracy === "unknown" ? null : v.birthTime!,
      accuracy: v.accuracy,
      latitude: v.latitude,
      longitude: v.longitude,
      timezone: v.timezone,
    },
  }));
