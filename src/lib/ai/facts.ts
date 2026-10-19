import {
  ASPECT_LABELS,
  bodyLabel,
  formatDegree,
  ordinal,
  pointLabel,
  signLabel,
} from "@/lib/astrology/interpretations";
import type { SynastryFacts } from "@/lib/astrology/synastry";
import {
  SIGNS,
  type AspectType,
  type Body,
  type ChartPoint,
  type NatalChart,
  type Sign,
} from "@/lib/astrology/types";
import type { PartnerSummary } from "@/lib/partner/service";

/**
 * The most synastry aspects the model is shown, tightest orbs first. The
 * evidence catalogue and the guard claims are built from this same list, so
 * every id the model can cite resolves and every aspect it can state is allowed.
 */
export const MAX_SYNASTRY_ASPECTS = 30;

export interface EvidenceItem {
  id: string;
  label: string;
}

export type OwnerKey = "a" | "b";

/** One person's share of the claims, so the guard can catch swapped partners. */
export interface OwnerClaims {
  /** Words that name this person in text: a name, or "your", "their" and so on. */
  aliases: string[];
  signs: Set<string>;
  /** Houses this person's planets fall in (for the other person's chart). */
  houses: Set<string>;
}

/** What the model is allowed to assert; the guard checks answers against it. */
export interface Claims {
  /** "venus:virgo" (lower-case point:sign); a Moon range adds every sign. */
  signs: Set<string>;
  /** "mars|venus|trine" (points sorted alphabetically). */
  aspects: Set<string>;
  /** "sun:7" */
  houses: Set<string>;
  /**
   * Per-person claims. When the text names an owner right before a point, the
   * guard checks that owner's sets; otherwise it checks the union above.
   */
  owners?: Partial<Record<OwnerKey, OwnerClaims>>;
}

/** A copy of `claims` with extra aliases, e.g. "your" for the viewer. */
export function withAliases(
  claims: Claims,
  extra: Partial<Record<OwnerKey, string[]>>,
): Claims {
  const owners: Claims["owners"] = {};
  for (const key of ["a", "b"] as const) {
    const owner = claims.owners?.[key];
    if (owner)
      owners[key] = {
        ...owner,
        aliases: [...owner.aliases, ...(extra[key] ?? [])],
      };
  }
  return { ...claims, owners };
}

export interface PersonSigns {
  bigThree: { sun: string; moon: string; ascendant: string } | null;
  signs: { body: Body; sign: string }[] | null;
}

export interface RelationshipFacts {
  names: { a: string; b: string };
  people: { a: PersonSigns; b: PersonSigns };
  evidence: EvidenceItem[];
  /** Uncertainty notes in plain English. */
  notes: string[];
  claims: Claims;
}

export interface NatalFacts {
  lines: string[];
  notes: string[];
  claims: Claims;
}

const emptyClaims = (): Claims => ({
  signs: new Set(),
  aspects: new Set(),
  houses: new Set(),
});

const aspectKey = (a: ChartPoint, b: ChartPoint, type: AspectType) =>
  `${[a, b].sort().join("|")}|${type}`;

/** How the aspect reads between two points: "Sun conjunct Moon", "Sun opposite Moon". */
const aspectWord = (type: AspectType) =>
  type === "conjunction"
    ? "conjunct"
    : type === "opposition"
      ? "opposite"
      : ASPECT_LABELS[type].toLowerCase();

const joinOr = (words: string[]) =>
  words.length < 2
    ? words.join("")
    : `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;

const isSign = (s: string): s is Sign =>
  (SIGNS as readonly string[]).includes(s);

/** Signs named in a summary string such as "Virgo" or "Gemini or Cancer". */
function signsIn(text: string): Sign[] {
  return text
    .toLowerCase()
    .split(/\s+or\s+/)
    .map((s) => s.trim())
    .filter(isSign);
}

function addSigns(
  claims: Claims,
  point: ChartPoint,
  signs: Sign[],
  owner?: OwnerClaims,
) {
  for (const sign of signs) {
    claims.signs.add(`${point}:${sign}`);
    owner?.signs.add(`${point}:${sign}`);
  }
}

const newOwner = (aliases: string[]): OwnerClaims => ({
  aliases,
  signs: new Set(),
  houses: new Set(),
});

export function buildRelationshipFacts(input: {
  names: { a: string; b: string };
  a: PartnerSummary;
  b: PartnerSummary;
  synastry: SynastryFacts;
}): RelationshipFacts {
  const { names, synastry } = input;
  const people = {
    a: { bigThree: input.a.bigThree, signs: input.a.signs },
    b: { bigThree: input.b.bigThree, signs: input.b.signs },
  };
  const evidence: EvidenceItem[] = [];
  const notes: string[] = [];
  const claims = emptyClaims();
  const owners = { a: newOwner([names.a]), b: newOwner([names.b]) };
  claims.owners = owners;

  const tightest = [...synastry.aspects]
    .sort((x, y) => x.orb - y.orb)
    .slice(0, MAX_SYNASTRY_ASPECTS);
  for (const x of tightest) {
    evidence.push({
      id: `syn:${x.a}-${x.type}-${x.b}`,
      label: `${names.a}'s ${pointLabel(x.a)} ${aspectWord(x.type)} ${names.b}'s ${pointLabel(x.b)} (orb ${x.orb.toFixed(1)}°)`,
    });
    claims.aspects.add(aspectKey(x.a, x.b, x.type));
  }

  const overlaySides = [
    { side: "a", guest: names.a, host: names.b, list: synastry.overlays.aInB },
    { side: "b", guest: names.b, host: names.a, list: synastry.overlays.bInA },
  ] as const;
  for (const { side, guest, host, list } of overlaySides) {
    for (const o of list ?? []) {
      evidence.push({
        id: `ovl:${side}-${o.body}-${o.house}`,
        label: `${guest}'s ${bodyLabel(o.body)} in ${host}'s ${ordinal(o.house)} house`,
      });
      claims.houses.add(`${o.body}:${o.house}`);
      owners[side].houses.add(`${o.body}:${o.house}`);
    }
  }

  for (const side of ["a", "b"] as const) {
    const person = people[side];
    const name = names[side];
    for (const { body, sign } of person.signs ?? []) {
      evidence.push({
        id: `sign:${side}-${body}`,
        label: `${name}'s ${bodyLabel(body)} in ${sign}`,
      });
      addSigns(claims, body, signsIn(sign), owners[side]);
    }
    const ascendant = person.bigThree ? signsIn(person.bigThree.ascendant) : [];
    if (person.bigThree && ascendant.length > 0) {
      evidence.push({
        id: `sign:${side}-ascendant`,
        label: `${name}'s Ascendant in ${person.bigThree.ascendant}`,
      });
      addSigns(claims, "ascendant", ascendant, owners[side]);
    }
  }

  const excluded = [
    { name: names.a, moon: synastry.excluded.aMoon },
    { name: names.b, moon: synastry.excluded.bMoon },
  ];
  for (const { name, moon } of excluded)
    if (moon)
      notes.push(
        `${name}'s birth time is unknown, so their Moon sign is uncertain and their houses and Ascendant are not used.`,
      );

  return { names, people, evidence, notes, claims };
}

export function buildNatalFacts(chart: NatalChart): NatalFacts {
  const lines: string[] = [];
  const notes: string[] = [];
  const claims = emptyClaims();
  // One chart, one owner: the sets are shared with the union.
  claims.owners = {
    a: { aliases: [], signs: claims.signs, houses: claims.houses },
  };
  const { timeAccuracy, moonSigns, ascendantSigns } = chart.uncertainty;
  const timeUnknown = timeAccuracy === "unknown";

  for (const p of chart.placements) {
    if (p.body === "moon" && moonSigns && moonSigns.length > 1) {
      lines.push(`Moon in ${joinOr(moonSigns.map(signLabel))}`);
      addSigns(claims, "moon", moonSigns);
      continue;
    }
    const parts = [`${bodyLabel(p.body)} in ${signLabel(p.sign)}`];
    // Without a birth time the Moon's degree is not meaningful.
    if (!(p.body === "moon" && timeUnknown)) parts.push(formatDegree(p.degree));
    if (p.house !== null) {
      parts.push(`${ordinal(p.house)} house`);
      claims.houses.add(`${p.body}:${p.house}`);
    }
    if (p.retrograde) parts.push("retrograde");
    lines.push(parts.join(", "));
    addSigns(claims, p.body, [p.sign]);
  }

  if (chart.ascendant) {
    if (ascendantSigns && ascendantSigns.length > 1) {
      lines.push(`Ascendant in ${joinOr(ascendantSigns.map(signLabel))}`);
      addSigns(claims, "ascendant", ascendantSigns);
    } else {
      lines.push(
        `Ascendant in ${signLabel(chart.ascendant.sign)}, ${formatDegree(chart.ascendant.degree)}`,
      );
      addSigns(claims, "ascendant", [chart.ascendant.sign]);
    }
  }
  if (chart.midheaven) {
    lines.push(
      `Midheaven in ${signLabel(chart.midheaven.sign)}, ${formatDegree(chart.midheaven.degree)}`,
    );
    addSigns(claims, "midheaven", [chart.midheaven.sign]);
  }

  for (const a of chart.aspects) {
    // An unknown-time Moon could be anywhere in its day's range, so no aspect.
    if (timeUnknown && (a.a === "moon" || a.b === "moon")) continue;
    lines.push(
      `${pointLabel(a.a)} ${aspectWord(a.type)} ${pointLabel(a.b)} (orb ${a.orb.toFixed(1)}°)`,
    );
    claims.aspects.add(aspectKey(a.a, a.b, a.type));
  }

  if (timeUnknown) {
    notes.push(
      moonSigns && moonSigns.length > 1
        ? `The birth time is unknown: the Moon sign may be ${joinOr(moonSigns.map(signLabel))}, and there are no houses or Ascendant.`
        : "The birth time is unknown, so there are no houses or Ascendant.",
    );
  } else if (timeAccuracy === "approximate") {
    if (ascendantSigns && ascendantSigns.length > 1)
      notes.push(
        `The birth time is approximate: the Ascendant may be ${joinOr(ascendantSigns.map(signLabel))}.`,
      );
  }

  return { lines, notes, claims };
}
