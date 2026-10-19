import type {
  Aspect,
  AspectType,
  BirthTimeAccuracy,
  Body,
  ChartPoint,
  Placement,
  Sign,
} from "./types";

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const bodyLabel = (b: Body) => capitalize(b);
export const signLabel = (s: Sign) => capitalize(s);
export const pointLabel = (p: ChartPoint) => capitalize(p);

export const PLANET_MEANINGS: Record<Body, string> = {
  sun: "Your core identity and what gives you energy.",
  moon: "Your emotional needs and what helps you feel safe.",
  mercury: "How you think, talk, and listen.",
  venus: "How you give and receive affection, and what you value.",
  mars: "How you act on desire, assert yourself, and handle conflict.",
  jupiter: "Where you look for growth, meaning, and optimism.",
  saturn: "Where you meet responsibility, limits, and long-term effort.",
  uranus: "Where you want freedom, change, and originality.",
  neptune: "Where you dream, idealize, and feel part of something larger.",
  pluto: "Where you experience intensity, transformation, and power.",
};

export const SIGN_KEYWORDS: Record<Sign, string> = {
  aries: "direct, energetic, and quick to start",
  taurus: "steady, sensual, and loyal",
  gemini: "curious, talkative, and adaptable",
  cancer: "protective, caring, and sensitive",
  leo: "warm, expressive, and proud",
  virgo: "thoughtful, practical, and attentive to detail",
  libra: "diplomatic, sociable, and fairness-minded",
  scorpio: "intense, private, and deeply committed",
  sagittarius: "adventurous, honest, and freedom-loving",
  capricorn: "ambitious, disciplined, and reliable",
  aquarius: "independent, inventive, and community-minded",
  pisces: "imaginative, empathetic, and gentle",
};

export const HOUSE_MEANINGS: Record<number, string> = {
  1: "self and first impressions",
  2: "money, possessions, and self-worth",
  3: "communication, learning, and siblings",
  4: "home, family, and roots",
  5: "romance, creativity, and play",
  6: "daily routines, work, and health habits",
  7: "partnerships and close relationships",
  8: "intimacy, shared resources, and transformation",
  9: "travel, beliefs, and higher learning",
  10: "career, reputation, and public life",
  11: "friends, groups, and hopes",
  12: "solitude, the unconscious, and rest",
};

export const ASPECT_LABELS: Record<AspectType, string> = {
  conjunction: "Conjunction",
  sextile: "Sextile",
  square: "Square",
  trine: "Trine",
  opposition: "Opposition",
};

export const ASPECT_MEANINGS: Record<AspectType, string> = {
  conjunction: "blend their energies closely",
  sextile: "support each other with easy opportunities",
  square: "create tension that pushes for growth",
  trine: "flow together naturally",
  opposition: "pull in different directions and look for balance",
};

export const ASCENDANT_MEANING =
  "Your rising sign: how you come across and approach new situations.";
export const MIDHEAVEN_MEANING = "Your public direction and aspirations.";
export const RETROGRADE_NOTE =
  "Retrograde means the planet appears to move backward from Earth. Traditionally, its energy is read as more inward and reflective.";

export const TIME_ACCURACY_LABELS: Record<BirthTimeAccuracy, string> = {
  exact: "Exact birth time",
  approximate: "Approximate birth time",
  unknown: "Birth time unknown",
};

export function formatDegree(degree: number): string {
  return `${Math.floor(degree)}°`;
}

export function describePlacement(p: Placement): string {
  const house = p.house
    ? ` It falls in the ${ordinal(p.house)} house, the area of ${HOUSE_MEANINGS[p.house]}.`
    : "";
  return `${PLANET_MEANINGS[p.body]} In ${signLabel(p.sign)}, this tends to be ${SIGN_KEYWORDS[p.sign]}.${house}`;
}

export function describeAspect(a: Aspect): string {
  return `${pointLabel(a.a)} and ${pointLabel(a.b)} ${ASPECT_MEANINGS[a.type]}.`;
}

export function ordinal(n: number): string {
  const suffix =
    n % 100 >= 11 && n % 100 <= 13
      ? "th"
      : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ??
        "th");
  return `${n}${suffix}`;
}
