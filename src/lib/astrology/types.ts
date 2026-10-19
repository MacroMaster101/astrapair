export const BODIES = [
  "sun",
  "moon",
  "mercury",
  "venus",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
] as const;
export type Body = (typeof BODIES)[number];

export const SIGNS = [
  "aries",
  "taurus",
  "gemini",
  "cancer",
  "leo",
  "virgo",
  "libra",
  "scorpio",
  "sagittarius",
  "capricorn",
  "aquarius",
  "pisces",
] as const;
export type Sign = (typeof SIGNS)[number];

export const BIRTH_TIME_ACCURACIES = [
  "exact",
  "approximate",
  "unknown",
] as const;
export type BirthTimeAccuracy = (typeof BIRTH_TIME_ACCURACIES)[number];

export const ASPECT_TYPES = [
  "conjunction",
  "sextile",
  "square",
  "trine",
  "opposition",
] as const;
export type AspectType = (typeof ASPECT_TYPES)[number];

export type ChartPoint = Body | "ascendant" | "midheaven";

export interface BirthInput {
  /** Local civil date, "YYYY-MM-DD". */
  birthDate: string;
  /** Local time "HH:mm"; null only when accuracy is "unknown". */
  birthTime: string | null;
  accuracy: BirthTimeAccuracy;
  latitude: number;
  longitude: number;
  /** IANA timezone id, e.g. "Asia/Colombo". */
  timezone: string;
}

export interface Placement {
  body: Body;
  /** Tropical ecliptic longitude, 0..360. */
  longitude: number;
  sign: Sign;
  /** Degrees within the sign, 0..30. */
  degree: number;
  retrograde: boolean;
  /** 1..12, or null when houses are unavailable. */
  house: number | null;
}

export interface Aspect {
  a: ChartPoint;
  b: ChartPoint;
  type: AspectType;
  /** Absolute deviation from the exact aspect angle, in degrees. */
  orb: number;
  /** null when either side is an angle (no meaningful speed). */
  applying: boolean | null;
}

export interface ChartAngle {
  longitude: number;
  sign: Sign;
  degree: number;
}

export interface NatalChart {
  schemaVersion: 1;
  engine: { name: string; version: string };
  zodiac: "tropical";
  houseSystem: "placidus" | "porphyry" | null;
  /** ISO instant the chart was calculated for. */
  utc: string;
  input: BirthInput;
  placements: Placement[];
  ascendant: ChartAngle | null;
  midheaven: ChartAngle | null;
  houses: { house: number; longitude: number; sign: Sign }[] | null;
  aspects: Aspect[];
  uncertainty: {
    timeAccuracy: BirthTimeAccuracy;
    ascendantSigns?: Sign[];
    moonSigns?: Sign[];
    dstWarning?: "nonexistent" | "ambiguous";
    houseFallback?: "polar_latitude";
  };
}

export interface AstrologyProvider {
  readonly name: string;
  readonly version: string;
  calculateNatalChart(input: BirthInput): NatalChart;
}
