import type { AspectType, ChartPoint } from "@/lib/astrology/types";
import { SIGNS } from "@/lib/astrology/types";
import type { Claims, OwnerKey } from "./facts";
import { cleanText } from "./prompts/names";

export interface UnsupportedClaim {
  text: string;
}

/** Soft hyphen, zero-width, bidirectional and Unicode tag characters, which cleanText leaves alone. */
const INVISIBLE =
  /[\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u{E0000}-\u{E007F}]/gu;
const MAX_REJECTED = 5;
const MAX_REJECTED_LENGTH = 120;

/**
 * The sentence a corrective retry adds after its generic opening: the
 * placements the guard rejected, in the model's own words (at most five, each
 * cut to 120 characters), and a pointer back to the facts. Nothing but the
 * model's text is quoted. Empty when nothing was rejected.
 */
export function rejectedPlacementsNote(found: UnsupportedClaim[]): string {
  const quoted = [
    ...new Set(
      found
        .map((f) =>
          cleanText(
            f.text
              .replace(INVISIBLE, "")
              .replace(/[\u2013\u2014]/g, "-")
              .replace(/"/g, "'")
              .replace(/[<>`{}]/g, ""),
          )
            .slice(0, MAX_REJECTED_LENGTH)
            .trim(),
        )
        .filter(Boolean),
    ),
  ].slice(0, MAX_REJECTED);
  if (quoted.length === 0) return "";
  return ` These were not in the facts: ${quoted.map((q) => `"${q}"`).join("; ")}. Use only the aspects and placements listed in the facts.`;
}

const POINT_WORDS = [
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
  "ascendant",
  "asc",
  "rising",
  "midheaven",
  "mc",
];
const POINT = `(?:${POINT_WORDS.join("|")})`;
const SIGN = `(?:${SIGNS.join("|")})`;
// Not "Leo-ruled": a sign that is part of a longer word.
const SIGN_END = "(?![\\p{L}-])";
/**
 * A sign, or a list of signs. A sign word that is also one of the people's
 * names ("Leo") is skipped when it is possessive: "Leo's 7th house".
 */
const signList = (nameSigns: string[]) => {
  // The possessive name stays in the list so the signs around it are still
  // read ("Leo's or Libra's light"); `signWord` leaves it out of the check.
  const one =
    nameSigns.length === 0
      ? SIGN
      : `(?:(?:${nameSigns.join("|")})(?='s?\\b)|${SIGN})`;
  return `${one}(?:(?:'s?)?\\s*(?:,|/|\\bor\\b)\\s*${one})*${SIGN_END}`;
};
/** Each sign in a matched list, skipping a possessive name ("Leo's"). */
const signWord = (nameSigns: string[]) =>
  new RegExp(
    nameSigns.length === 0
      ? SIGN
      : `(?!(?:${nameSigns.join("|")})'s?\\b)${SIGN}`,
    "g",
  );
const DEGREES =
  "\\d{1,2}(?:\\.\\d+)?\\s*°(?:\\s*\\d{1,2}(?:\\.\\d+)?\\s*['′]?)?";

/** Words each aspect can be written with, including verbs and past tense. */
const ASPECT_WORDS: Record<AspectType, string> = {
  conjunction: "conjunct(?:s|ed|ing|ion|ions)?|conjoin(?:s|ed|ing)?",
  opposition: "opposite|oppos(?:ition|itions|es|ed|e|ing)",
  // "squares off" is the idiom for a stand-off, not the aspect.
  square: "squar(?:e|es|ed|ing)(?!\\s+off\\b)",
  trine: "trin(?:e|es|ed|ing)",
  sextile: "sextil(?:e|es|ed|ing)",
};
const ASPECT_TYPE_PATTERNS = (
  Object.entries(ASPECT_WORDS) as [AspectType, string][]
).map(([type, words]) => ({ type, re: new RegExp(`^(?:${words})$`, "i") }));
const ASPECT = `(?:${Object.values(ASPECT_WORDS).join("|")})`;

// "opposite", "opposing" and "square" are also everyday adjectives ("opposite
// needs", "square pegs"), so they only count as the aspect in a clear position.
/** A pair's aspect adjective must end the clause or be "... each other". */
const ADJECTIVE_END =
  "(?:[ \\t]*(?:$|[,.;:!?)\\n])|\\s+(?:(?:to|with)\\s+)?each\\s+other\\b)";
/**
 * "The Sun and Moon square adds friction": after a pair, "square" followed by a
 * verb is the aspect noun, not the adjective of "square pegs".
 */
const VERB_AFTER =
  "\\s+(?:is|was|will|would|can|could|may|might|should|must|has|does|adds|brings|creates|makes|gives|causes|suggests|shows|means|feels|produces|invites|sparks|generates|introduces|indicates|signals|tends|seems|leads|triggers|requires|demands|puts|asks|pulls|pushes)\\b";

/** Up to 40 characters inside one sentence that never cross another point. */
const GAP = `(?:(?!\\b${POINT}\\b)[^.!?;\\n]){0,40}?`;
// A possessive word is capped so a long run of letters and hyphens cannot make
// the owner patterns backtrack over the whole run from every start.
const POSSESSIVE = "[\\p{L}\\p{M}-]{1,40}'s";
const DETERMINER = `(?:your|their|the|his|her|our|my|${POSSESSIVE})`;

// Any other possessive or article right before a point, so pairs still read.
const GENERIC_OWNER = `(?:your|their|his|her|our|my|the|${POSSESSIVE})`;

const ORDINAL_WORDS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
};
const ORDINAL = `(?:\\d{1,2}(?:st|nd|rd|th)|${Object.keys(ORDINAL_WORDS).join("|")})`;

/** What may follow "in the 7th" when "house" is left out. */
const BARE_ORDINAL_END =
  /^\s*(?:$|[,.;:!?)]|(?:and|or|but|while|which|where|because|is|are|was|can|may|will|makes?|brings?|gives?|suggests?|shows?)\b)/i;

/** How far back a list of points is read, and the most points in one list. */
const LIST_WINDOW = 120;
const LIST_MAX = 15;

/** "receives a trine from": the aspect is a noun with a source. */
const NOUN_FORM = new RegExp(
  `\\b(?:an?|the)\\s+${ASPECT}\\s+(?:from|with|by|to)\\b`,
  "i",
);

/** How far back a verb before an aspect phrase is looked for. */
const VERB_WINDOW = 80;
/** A join word at the end of the text between a point and "in". */
const CLAUSE_JOIN = /\b(?:and|but|while|whereas|so|yet|or)\s*$/i;

const PRONOUNS = new Set(["your", "my", "our", "their", "his", "her", "its"]);
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Matchers {
  ownerOf: (alias: string | undefined) => OwnerKey | null;
  signClaim: RegExp;
  signWord: RegExp;
  signFirst: RegExp;
  aspectPlain: RegExp;
  aspectPair: RegExp;
  aspectPairHyphen: RegExp;
  aspectFirst: RegExp;
  /** Later pairs of "trines between A and B, C and D" (sticky). */
  pairBetween: RegExp;
  pairBare: RegExp;
  /** "a trine from A and a square from B" after a subject (sticky). */
  aspectChain: RegExp;
  /** "Mars squares the" right before an aspect phrase. */
  verbBefore: RegExp;
  houseClaim: RegExp;
  back: RegExp;
}

// Small LRU: the key holds both people's names, so it must not grow unbounded.
const CACHE_LIMIT = 50;
const cache = new Map<string, Matchers>();

function buildMatchers(claims: Claims): Matchers {
  const aliasOwner = new Map<string, OwnerKey | null>();
  for (const key of ["a", "b"] as const) {
    for (const raw of claims.owners?.[key]?.aliases ?? []) {
      const alias = raw.trim().toLowerCase();
      if (!alias) continue;
      const seen = aliasOwner.get(alias);
      // A word shared by both people cannot decide whose planet it is.
      aliasOwner.set(alias, seen === undefined || seen === key ? key : null);
    }
  }
  const usable = [...aliasOwner.entries()]
    .filter(([, owner]) => owner !== null)
    .map(([alias]) => alias)
    .sort((x, y) => y.length - x.length);
  const cacheKey = JSON.stringify(
    usable.map((alias) => [alias, aliasOwner.get(alias)]),
  );
  const hit = cache.get(cacheKey);
  if (hit) {
    cache.delete(cacheKey);
    cache.set(cacheKey, hit);
    return hit;
  }

  const ownerAlt =
    usable.length === 0
      ? "(?!)"
      : usable
          .map((alias) =>
            PRONOUNS.has(alias)
              ? escapeRegex(alias)
              : `${escapeRegex(alias)}(?:'s|')`,
          )
          .join("|");
  // A point, optionally right after an owner word ("Kavisha's", "your").
  const P = (n: string) =>
    `(?:(?:(?<o${n}>${ownerAlt})|${GENERIC_OWNER})\\s+)?(?<p${n}>${POINT})\\b`;
  const flags = "giu";
  const nameSigns = usable.filter((alias) =>
    (SIGNS as readonly string[]).includes(alias),
  );
  const SIGN_LIST = signList(nameSigns);

  const signTail =
    `(?<tail>` +
    // Venus in Libra, Venus is in Libra, Venus, which is in Libra
    `(?:\\s+sign)?,?\\s+(?:(?:which|that)\\s+is\\s+)?(?:(?:is|are|falls|sits|sitting|lands|lies|placed|located|currently)\\s+)*in\\s+${SIGN_LIST}` +
    // Sun sign is Leo, Ascendant is Leo
    `|(?:\\s+sign)?\\s+(?:is|are|was|=)\\s+(?:an?\\s+)?${SIGN_LIST}` +
    // Venus (Libra)
    `|\\s*\\(\\s*${SIGN_LIST}\\s*\\)` +
    // Venus at 14 degrees Libra
    `|,?\\s+(?:at\\s+)?${DEGREES}\\s+(?:in\\s+)?${SIGN_LIST}` +
    `)`;

  const matchers: Matchers = {
    ownerOf: (alias) => {
      if (!alias) return null;
      const key = alias.toLowerCase().replace(/'s?$/, "");
      return aliasOwner.get(key) ?? null;
    },
    signClaim: new RegExp(`\\b${P("1")}${signTail}`, flags),
    signWord: signWord(nameSigns),
    signFirst: new RegExp(
      `\\b(?:(?<o1>${ownerAlt})\\s+)?(?<s1>${SIGN})\\s+(?<p1>${POINT})\\b`,
      flags,
    ),
    // "Venus is opposite your Mars", but not "pulls in the opposite direction from Mars".
    // "square" also reads before "from" and "of": "a square from your Mars".
    aspectPlain: new RegExp(
      `\\b${P("1")}${GAP}\\b(?<w>(?!(?:opposite|opposing)\\b(?!\\s+(?:(?:to|with)\\s+)?(?:(?:${ownerAlt}|${GENERIC_OWNER})\\s+)?${POINT}\\b)|square\\b(?!\\s+(?:(?:to|with|from|of)\\s+)?(?:(?:${ownerAlt}|${GENERIC_OWNER})\\s+)?${POINT}\\b))${ASPECT})\\b${GAP}\\b${P("2")}`,
      flags,
    ),
    // "Venus-Mars trine", "Sun and Moon are in opposition". Not "Sun and Moon
    // trine Venus": that is two aspects to a third point.
    aspectPair: new RegExp(
      `\\b${P("1")}(?:\\s*[-/\\u2013]\\s*|\\s+and\\s+|\\s*&\\s*)${P("2")}${GAP}\\b(?<w>(?!(?:opposite|opposing)\\b(?!${ADJECTIVE_END})|square\\b(?!${ADJECTIVE_END}|${VERB_AFTER}))${ASPECT})\\b(?!\\s+(?:(?:with|to|from|against|the|your|their|his|her|our|my|[\\p{L}\\p{M}-]+'s)\\s+){0,2}${POINT}\\b)`,
      flags,
    ),
    // "The Sun-Moon square adds friction": after a hyphen or slash "square" is
    // the aspect whatever follows.
    aspectPairHyphen: new RegExp(
      `\\b${P("1")}\\s*[-/\\u2013]\\s*${P("2")}${GAP}\\b(?<w>(?!(?:opposite|opposing)\\b(?!${ADJECTIVE_END}))${ASPECT})\\b(?!\\s+(?:(?:with|to|from|against|the|your|their|his|her|our|my|[\\p{L}\\p{M}-]+'s)\\s+){0,2}${POINT}\\b)`,
      flags,
    ),
    // "a trine between Venus and Mars", "the square from your Mars to their Venus"
    aspectFirst: new RegExp(
      `\\b(?<w>(?!opposite|opposing)${ASPECT})\\b\\s+(?:between|from|of)\\s+${P("1")}\\s+(?:and|to|with)\\s+${P("2")}`,
      flags,
    ),
    // ", your Mars and their Moon" or ", and between your Mars and their Moon"
    // right after an aspect phrase: one more pair of the same aspect.
    pairBetween: new RegExp(
      `\\s*(?:,\\s*(?:and\\s+|plus\\s+)?|;\\s*|\\s+and\\s+|\\s+plus\\s+)(?:between|from|of)\\s+(?<pair>${P("1")}\\s+(?:and|to|with)\\s+${P("2")})`,
      "iuy",
    ),
    // Not "..., and Sun and Moon in Leo": that is a sign claim.
    pairBare: new RegExp(
      `\\s*(?:,\\s*(?:and\\s+|plus\\s+)?|;\\s*|\\s+and\\s+)(?<pair>${P("1")}\\s+(?:and|to|with)\\s+${P("2")})(?!\\s+(?:are\\s+|both\\s+)?in\\b)`,
      "iuy",
    ),
    aspectChain: new RegExp(
      `\\s*(?:,\\s*(?:and\\s+|plus\\s+)?|;\\s*|\\s+and\\s+|\\s+plus\\s+|\\s+as\\s+well\\s+as\\s+)(?:also\\s+)?(?<item>(?:an?|the)\\s+(?<w>${ASPECT})\\s+(?:from|with|by|to)\\s+${P("3")})`,
      "iuy",
    ),
    // "Your Mars squares the" ending the text before an aspect phrase.
    verbBefore: new RegExp(
      `\\b${P("0")}${GAP}\\b(?<w>${ASPECT})\\s+(?:the|an?|that|this)\\s+$`,
      "iu",
    ),
    houseClaim: new RegExp(
      `\\b${P("1")}(?<rest>(?<gap>${GAP})\\bin\\s+(?:(?<det>${DETERMINER})\\s+)?(?<ord>${ORDINAL})(?<house>\\s+house)?\\b)`,
      flags,
    ),
    // A point followed by a list separator, ending the text so far.
    back: new RegExp(
      `\\b${P("")}\\s*(?<sep>,\\s*(?:and\\s+)?|\\s+and\\s+|\\s*&\\s*)$`,
      "iu",
    ),
  };
  cache.set(cacheKey, matchers);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return matchers;
}

function normalizePoint(word: string): ChartPoint {
  const w = word.toLowerCase();
  if (w === "rising" || w === "asc") return "ascendant";
  if (w === "mc") return "midheaven";
  return w as ChartPoint;
}

function aspectType(word: string): AspectType | null {
  return ASPECT_TYPE_PATTERNS.find((p) => p.re.test(word))?.type ?? null;
}

interface Mention {
  owner: OwnerKey | null;
  point: ChartPoint;
}

/**
 * Finds sign, aspect and house claims in `text` that are not in `claims`.
 * A mention without a sign, aspect or house (such as "your Venus") is not a claim.
 * When an owner word ("Kavisha's", "your") comes right before a point, that
 * person's own placements are checked; otherwise either person's will do.
 */
export function findUnsupportedClaims(
  text: string,
  claims: Claims,
): UnsupportedClaim[] {
  const rx = buildMatchers(claims);
  const normalized = text.replace(/[‘’]/g, "'");
  const found = new Map<string, UnsupportedClaim>();
  const flag = (identity: string, snippet: string) => {
    if (!found.has(identity))
      found.set(identity, { text: snippet.replace(/\s+/g, " ").trim() });
  };

  const mention = (owner: string | undefined, point: string): Mention => ({
    owner: rx.ownerOf(owner),
    point: normalizePoint(point),
  });

  /** Where each aspect phrase found in the text ends, in order once collected. */
  const spanEnds: number[] = [];
  /** The last aspect phrase end at or before `index`, or 0. */
  const lastSpanEnd = (index: number) => {
    let lo = 0;
    let hi = spanEnds.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (spanEnds[mid] <= index) lo = mid + 1;
      else hi = mid;
    }
    return lo === 0 ? 0 : spanEnds[lo - 1];
  };

  /**
   * The point plus any list of points ending right before it: "Sun, Moon and".
   * The list is read back to its start, but not past the end of an aspect
   * phrase: in "Sun trines their Venus, and Moon in Cancer" Venus belongs to the
   * aspect. It looks back a bounded distance, at most one list's worth, so the
   * work stays linear. Aspect phrases must be read before this is called.
   */
  const withList = (last: Mention, index: number): Mention[] => {
    const list: Mention[] = [last];
    const floor = lastSpanEnd(index);
    let end = index;
    while (list.length < LIST_MAX) {
      const from = Math.max(0, end - LIST_WINDOW);
      const m = rx.back.exec(normalized.slice(from, end));
      if (!m?.groups) break;
      const start = from + m.index;
      if (start < floor) break;
      list.unshift(mention(m.groups.o, m.groups.p));
      end = start;
    }
    const shared = list.find((x) => x.owner)?.owner ?? null;
    return list.map((x) => ({ owner: x.owner ?? shared, point: x.point }));
  };

  const set = (
    pick: "signs" | "houses",
    owner: OwnerKey | null,
  ): Set<string> => {
    const own = owner ? claims.owners?.[owner] : undefined;
    return own ? own[pick] : claims[pick];
  };

  const checkAspect = (
    a: Mention,
    b: Mention,
    word: string,
    snippet: string,
  ) => {
    const type = aspectType(word);
    if (!type) return;
    const key = `${[a.point, b.point].sort().join("|")}|${type}`;
    if (!claims.aspects.has(key)) flag(`aspect|${key}`, snippet);
  };
  /**
   * Reads `scan`; snippets come from `shown`, the same text before any masking.
   * With `chain`, "a trine from A and a square from B" after a match binds each
   * later aspect to the match's first point.
   */
  const readAspects = (
    re: RegExp,
    scan: string,
    offset: number,
    shown = scan,
    chain = false,
  ) => {
    const claimed: [number, number][] = [];
    re.lastIndex = 0;
    for (let m = re.exec(scan); m; m = re.exec(scan)) {
      let end = m.index + m[0].length;
      const g = m.groups!;
      checkAspect(
        mention(g.o1, g.p1),
        mention(g.o2, g.p2),
        g.w,
        shown.slice(m.index, end),
      );
      // The aspect word ends the match.
      const at = end - g.w.length;
      claimed.push([at, at + g.w.length]);
      if (chain && NOUN_FORM.test(m[0])) {
        const subject = mention(g.o1, g.p1);
        for (let n = 0; n < LIST_MAX; n++) {
          rx.aspectChain.lastIndex = end;
          const c = rx.aspectChain.exec(scan);
          if (!c?.groups) break;
          end = c.index + c[0].length;
          checkAspect(
            subject,
            mention(c.groups.o3, c.groups.p3),
            c.groups.w,
            shown.slice(end - c.groups.item.length, end),
          );
        }
      }
      spanEnds.push(offset + end);
      // The next match starts after the chain: its text belongs to this one.
      re.lastIndex = end;
    }
    return claimed;
  };
  /** `text` with the given spans blanked out (same length). */
  const blank = (text: string, spans: [number, number][]) => {
    let out = "";
    let from = 0;
    for (const [a, b] of spans) {
      out += text.slice(from, a) + " ".repeat(b - a);
      from = b;
    }
    return out + text.slice(from);
  };
  /** The next pair of a list, right at `at` (sticky), or null. */
  const pairAt = (at: number) => {
    for (const re of [rx.pairBetween, rx.pairBare]) {
      re.lastIndex = at;
      const hit = re.exec(normalized);
      if (hit) return hit;
    }
    return null;
  };
  // "the trine between A and B" names its own two points. Each such phrase
  // starts a new stretch of text, so a point before it ("... Alex's Venus, and
  // the trine between ...") is never paired with its aspect word or points.
  const phrases = [...normalized.matchAll(rx.aspectFirst)];
  const starts = [0, ...phrases.map((m) => m.index)];
  starts.forEach((start, i) => {
    const stretch = normalized.slice(start, starts[i + 1]);
    // "The Sun-Venus trine and the Jupiter-Moon trine": a pair form owns its
    // aspect word, so a plain "Venus ... trine ... Jupiter" cannot reuse it.
    const hyphen = readAspects(rx.aspectPairHyphen, stretch, start);
    const masked = blank(stretch, hyphen);
    const paired = readAspects(rx.aspectPair, masked, start, stretch);
    readAspects(rx.aspectPlain, blank(masked, paired), start, stretch, true);
  });
  for (const m of phrases) {
    const g = m.groups!;
    const type = g.w;
    let end = m.index + m[0].length;
    const first = mention(g.o1, g.p1);
    const second = mention(g.o2, g.p2);
    checkAspect(first, second, type, m[0]);
    // "Your Mars squares the trine between ...": the verb claims the aspect
    // for each point of the phrase.
    const before = normalized.slice(
      Math.max(0, m.index - VERB_WINDOW),
      m.index,
    );
    const verb = rx.verbBefore.exec(before);
    if (verb?.groups) {
      const subject = mention(verb.groups.o0, verb.groups.p0);
      const shown = normalized.slice(m.index - before.length + verb.index, end);
      checkAspect(subject, first, verb.groups.w, shown);
      checkAspect(subject, second, verb.groups.w, shown);
    }
    // "Trines between A and B, C and D, and E and F": every later pair.
    for (let n = 0; n < LIST_MAX; n++) {
      const next = pairAt(end);
      if (!next?.groups) break;
      end = next.index + next[0].length;
      checkAspect(
        mention(next.groups.o1, next.groups.p1),
        mention(next.groups.o2, next.groups.p2),
        type,
        next.groups.pair,
      );
    }
    spanEnds.push(end);
  }

  spanEnds.sort((a, b) => a - b);

  const checkSigns = (list: Mention[], signs: string[], snippet: string) => {
    for (const { owner, point } of list)
      for (const sign of signs)
        if (!set("signs", owner).has(`${point}:${sign}`))
          flag(`sign|${owner ?? ""}|${point}|${sign}`, snippet);
  };

  for (const m of normalized.matchAll(rx.signClaim)) {
    const g = m.groups!;
    // Two characters past the match, so a closing "'s" is visible.
    const end = m.index + m[0].length;
    const tail = normalized.slice(end - g.tail.length, end + 2);
    const signs = tail.toLowerCase().match(rx.signWord) ?? [];
    checkSigns(withList(mention(g.o1, g.p1), m.index), signs, m[0]);
  }

  for (const m of normalized.matchAll(rx.signFirst)) {
    const g = m.groups!;
    checkSigns([mention(g.o1, g.p1)], [g.s1.toLowerCase()], m[0]);
  }

  for (const m of normalized.matchAll(rx.houseClaim)) {
    const g = m.groups!;
    // "... their Venus, and in the 4th house their Mars ...", "The Sun shines
    // and in the 4th house Mars rests": a join right before "in" opens the next
    // clause, so the house binds forward to the point that follows.
    if (CLAUSE_JOIN.test(g.gap)) continue;
    if (!g.house) {
      // An ordinal word needs "house" ("in the first weeks" is not a house).
      if (!/^\d/.test(g.ord) || !g.det) continue;
      // "Venus in the 7th" ends the clause; "in the 1st week" does not.
      const rest = normalized.slice(m.index + m[0].length);
      if (!BARE_ORDINAL_END.test(rest)) continue;
    }
    const n = /^\d/.test(g.ord)
      ? parseInt(g.ord, 10)
      : ORDINAL_WORDS[g.ord.toLowerCase()];
    for (const { owner, point } of withList(mention(g.o1, g.p1), m.index))
      if (!set("houses", owner).has(`${point}:${n}`))
        flag(`house|${owner ?? ""}|${point}|${n}`, m[0]);
  }

  return [...found.values()];
}
