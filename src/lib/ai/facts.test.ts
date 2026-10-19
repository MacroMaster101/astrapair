import { describe, expect, it, vi } from "vitest";
import { BuiltInProvider } from "@/lib/astrology/engine";
import { calculateSynastry } from "@/lib/astrology/synastry";
import { BODIES, type BirthInput } from "@/lib/astrology/types";
import {
  MAX_SYNASTRY_ASPECTS,
  buildNatalFacts,
  buildRelationshipFacts,
  withAliases,
} from "./facts";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireUserId: vi.fn(),
  getProfile: vi.fn(),
}));
vi.mock("@/lib/birth-profile/service", () => ({
  getOwnBirthProfile: vi.fn(),
  getCurrentChart: vi.fn(),
  getChartForVerifiedPartner: vi.fn(),
}));

const { summarizeChart } = await import("@/lib/partner/service");

const provider = new BuiltInProvider();
const colombo: BirthInput = {
  birthDate: "1990-07-15",
  birthTime: "12:00",
  accuracy: "exact",
  latitude: 6.93548,
  longitude: 79.84868,
  timezone: "Asia/Colombo",
};
const london: BirthInput = {
  birthDate: "1988-02-03",
  birthTime: "08:45",
  accuracy: "exact",
  latitude: 51.5074,
  longitude: -0.1278,
  timezone: "Europe/London",
};
const chartA = provider.calculateNatalChart(colombo);
const chartB = provider.calculateNatalChart(london);
const chartBUnknown = provider.calculateNatalChart({
  ...london,
  birthTime: null,
  accuracy: "unknown",
});
// A day on which the Moon changes sign, found deterministically from the engine.
const rangeDay = (() => {
  for (let day = 1; day <= 28; day++) {
    const birthDate = `1988-03-${String(day).padStart(2, "0")}`;
    const chart = provider.calculateNatalChart({
      ...london,
      birthDate,
      birthTime: null,
      accuracy: "unknown",
    });
    if ((chart.uncertainty.moonSigns?.length ?? 0) > 1) return birthDate;
  }
  throw new Error("No Moon sign change found");
})();
const chartBRange = provider.calculateNatalChart({
  ...london,
  birthDate: rangeDay,
  birthTime: null,
  accuracy: "unknown",
});
const chartBApprox = provider.calculateNatalChart({
  ...london,
  accuracy: "approximate",
});
// An approximate time near a rising-sign change, found from the engine.
const chartBAscRange = (() => {
  for (let hour = 0; hour < 24; hour++) {
    for (const minute of [0, 30]) {
      const chart = provider.calculateNatalChart({
        ...london,
        birthTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        accuracy: "approximate",
      });
      if ((chart.uncertainty.ascendantSigns?.length ?? 0) > 1) return chart;
    }
  }
  throw new Error("No Ascendant change found");
})();

const names = { a: "Kavisha", b: "Alex" };
const build = (b = chartB) =>
  buildRelationshipFacts({
    names,
    a: summarizeChart(chartA, names.a),
    b: summarizeChart(b, names.b),
    synastry: calculateSynastry(chartA, b),
  });

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** How an aspect reads between two points in the model's evidence. */
const word = (type: string) =>
  type === "conjunction"
    ? "conjunct"
    : type === "opposition"
      ? "opposite"
      : type;
const birthStrings = (input: BirthInput) => [
  input.birthDate,
  ...(input.birthTime ? [input.birthTime] : []),
  input.timezone,
  String(input.latitude),
  String(input.longitude),
];

describe("buildRelationshipFacts", () => {
  const facts = build();
  const synastry = calculateSynastry(chartA, chartB);

  it("has an aspect item per synastry aspect with a readable label", () => {
    const first = synastry.aspects[0];
    const item = facts.evidence.find(
      (e) => e.id === `syn:${first.a}-${first.type}-${first.b}`,
    );
    expect(item?.label).toBe(
      `Kavisha's ${capital(first.a)} ${word(first.type)} Alex's ${capital(first.b)} (orb ${first.orb.toFixed(1)}°)`,
    );
    expect(facts.evidence.filter((e) => e.id.startsWith("syn:"))).toHaveLength(
      Math.min(synastry.aspects.length, MAX_SYNASTRY_ASPECTS),
    );
  });

  it("caps the aspects to the tightest orbs, in evidence and claims alike", () => {
    // 45 distinct aspects with distinct orbs, loosest first.
    const aspects = Array.from({ length: 45 }, (_, i) => ({
      a: BODIES[i % BODIES.length],
      b: BODIES[(i + 1 + Math.floor(i / BODIES.length)) % BODIES.length],
      type: "trine" as const,
      orb: 8 - i * 0.1,
    }));
    const capped = buildRelationshipFacts({
      names,
      a: summarizeChart(chartA, names.a),
      b: summarizeChart(chartB, names.b),
      synastry: { ...synastry, aspects },
    });
    const syn = capped.evidence.filter((e) => e.id.startsWith("syn:"));
    expect(syn).toHaveLength(MAX_SYNASTRY_ASPECTS);
    const kept = [...aspects]
      .sort((x, y) => x.orb - y.orb)
      .slice(0, MAX_SYNASTRY_ASPECTS);
    expect(syn.map((e) => e.id)).toEqual(
      kept.map((x) => `syn:${x.a}-${x.type}-${x.b}`),
    );
    // Everything dropped is neither citable nor claimable.
    const dropped = aspects.filter((x) => !kept.includes(x));
    expect(dropped.length).toBe(45 - MAX_SYNASTRY_ASPECTS);
    for (const x of dropped) {
      expect(syn.some((e) => e.id === `syn:${x.a}-${x.type}-${x.b}`)).toBe(
        false,
      );
    }
    // Every kept aspect is in the guard claims.
    for (const x of kept)
      expect(
        capped.claims.aspects.has([x.a, x.b].sort().join("|") + `|${x.type}`),
      ).toBe(true);
    expect(capped.claims.aspects.size).toBeLessThanOrEqual(
      MAX_SYNASTRY_ASPECTS,
    );
  });

  it("words conjunctions as conjunct and oppositions as opposite", () => {
    const custom = buildRelationshipFacts({
      names,
      a: summarizeChart(chartA, names.a),
      b: summarizeChart(chartB, names.b),
      synastry: {
        ...synastry,
        aspects: [
          { a: "sun", b: "moon", type: "conjunction", orb: 1.2 },
          { a: "venus", b: "mars", type: "opposition", orb: 2.3 },
        ],
      },
    });
    expect(custom.evidence.slice(0, 2).map((e) => e.label)).toEqual([
      "Kavisha's Sun conjunct Alex's Moon (orb 1.2°)",
      "Kavisha's Venus opposite Alex's Mars (orb 2.3°)",
    ]);
    expect(custom.claims.aspects.has("moon|sun|conjunction")).toBe(true);
    expect(custom.claims.aspects.has("mars|venus|opposition")).toBe(true);
  });

  it("has owner claims for each person, with the names as aliases", () => {
    const owners = facts.claims.owners!;
    expect(owners.a!.aliases).toEqual(["Kavisha"]);
    expect(owners.b!.aliases).toEqual(["Alex"]);
    const venusA = chartA.placements.find((p) => p.body === "venus")!;
    const venusB = chartB.placements.find((p) => p.body === "venus")!;
    expect(owners.a!.signs.has(`venus:${venusA.sign}`)).toBe(true);
    expect(owners.b!.signs.has(`venus:${venusB.sign}`)).toBe(true);
    expect(owners.a!.signs.has("ascendant:" + chartA.ascendant!.sign)).toBe(
      true,
    );
    // A's planets in B's houses belong to A, and the other way round.
    for (const o of synastry.overlays.aInB!)
      expect(owners.a!.houses.has(`${o.body}:${o.house}`)).toBe(true);
    for (const o of synastry.overlays.bInA!)
      expect(owners.b!.houses.has(`${o.body}:${o.house}`)).toBe(true);
    const union = new Set([...owners.a!.signs, ...owners.b!.signs]);
    expect(union).toEqual(facts.claims.signs);
  });

  it("lets callers add pronoun aliases without changing the original", () => {
    const withPronouns = withAliases(facts.claims, {
      a: ["your"],
      b: ["their"],
    });
    expect(withPronouns.owners!.a!.aliases).toEqual(["Kavisha", "your"]);
    expect(withPronouns.owners!.b!.aliases).toEqual(["Alex", "their"]);
    expect(facts.claims.owners!.a!.aliases).toEqual(["Kavisha"]);
  });

  it("has overlay items in both directions", () => {
    const aInB = synastry.overlays.aInB!.find((o) => o.body === "sun")!;
    const bInA = synastry.overlays.bInA!.find((o) => o.body === "venus")!;
    const th = (n: number) => ({ 1: "1st", 2: "2nd", 3: "3rd" })[n] ?? `${n}th`;
    expect(
      facts.evidence.find((e) => e.id === `ovl:a-sun-${aInB.house}`),
    ).toEqual({
      id: `ovl:a-sun-${aInB.house}`,
      label: `Kavisha's Sun in Alex's ${th(aInB.house)} house`,
    });
    expect(
      facts.evidence.find((e) => e.id === `ovl:b-venus-${bInA.house}`)?.label,
    ).toBe(`Alex's Venus in Kavisha's ${th(bInA.house)} house`);
  });

  it("has sign items for every body and the ascendant", () => {
    const venusA = chartA.placements.find((p) => p.body === "venus")!;
    expect(facts.evidence.find((e) => e.id === "sign:a-venus")?.label).toBe(
      `Kavisha's Venus in ${capital(venusA.sign)}`,
    );
    for (const p of chartB.placements)
      expect(facts.evidence.some((e) => e.id === `sign:b-${p.body}`)).toBe(
        true,
      );
    expect(facts.evidence.find((e) => e.id === "sign:a-ascendant")?.label).toBe(
      `Kavisha's Ascendant in ${capital(chartA.ascendant!.sign)}`,
    );
    expect(facts.evidence.some((e) => e.id === "sign:b-ascendant")).toBe(true);
  });

  it("has unique evidence ids and no notes when every time is known", () => {
    const ids = facts.evidence.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(facts.notes).toEqual([]);
  });

  it("carries names and each person's signs", () => {
    expect(facts.names).toEqual(names);
    expect(facts.people.a.bigThree?.sun).toBe(
      capital(chartA.placements.find((p) => p.body === "sun")!.sign),
    );
    expect(facts.people.b.signs).toHaveLength(10);
  });

  it("claims the signs, aspects and houses that are in the facts", () => {
    const venusA = chartA.placements.find((p) => p.body === "venus")!;
    expect(facts.claims.signs.has(`venus:${venusA.sign}`)).toBe(true);
    expect(facts.claims.signs.has(`ascendant:${chartA.ascendant!.sign}`)).toBe(
      true,
    );
    const first = synastry.aspects[0];
    const key = [first.a, first.b].sort().join("|") + `|${first.type}`;
    expect(facts.claims.aspects.has(key)).toBe(true);
    const overlay = synastry.overlays.aInB![0];
    expect(facts.claims.houses.has(`${overlay.body}:${overlay.house}`)).toBe(
      true,
    );
    expect(facts.claims.aspects.has("sun|sun|sun")).toBe(false);
  });

  it("notes an unknown birth time and claims the Moon range", () => {
    const unknown = build(chartBRange);
    expect(unknown.notes).toEqual([
      "Alex's birth time is unknown, so their Moon sign is uncertain and their houses and Ascendant are not used.",
    ]);
    expect(unknown.evidence.some((e) => e.id === "sign:b-ascendant")).toBe(
      false,
    );
    expect(unknown.evidence.some((e) => e.id.startsWith("ovl:a-"))).toBe(false);
    expect(
      unknown.evidence.some(
        (e) => e.id.startsWith("syn:") && e.id.endsWith("-moon"),
      ),
    ).toBe(false);
    expect(unknown.evidence.some((e) => e.id.startsWith("ovl:b-moon-"))).toBe(
      false,
    );
    const moonSigns = chartBRange.uncertainty.moonSigns!;
    expect(moonSigns.length).toBeGreaterThan(1);
    for (const sign of moonSigns)
      expect(unknown.claims.signs.has(`moon:${sign}`)).toBe(true);
    expect(unknown.evidence.find((e) => e.id === "sign:b-moon")?.label).toBe(
      `Alex's Moon in ${moonSigns.map(capital).join(" or ")}`,
    );
  });

  it("notes an excluded Moon for each side that is excluded", () => {
    const chartAUnknown = provider.calculateNatalChart({
      ...colombo,
      birthTime: null,
      accuracy: "unknown",
    });
    const both = buildRelationshipFacts({
      names,
      a: summarizeChart(chartAUnknown, names.a),
      b: summarizeChart(chartBUnknown, names.b),
      synastry: calculateSynastry(chartAUnknown, chartBUnknown),
    });
    expect(both.notes).toHaveLength(2);
    expect(both.notes[0]).toContain("Kavisha's birth time is unknown");
  });

  it("handles a partner without a chart", () => {
    const noChart = buildRelationshipFacts({
      names,
      a: summarizeChart(chartA, names.a),
      b: summarizeChart(null, names.b),
      synastry: calculateSynastry(chartA, chartB),
    });
    expect(noChart.people.b).toEqual({ bigThree: null, signs: null });
    expect(noChart.evidence.some((e) => e.id.startsWith("sign:b-"))).toBe(
      false,
    );
  });

  it("contains no birth date, time, timezone or coordinates", () => {
    for (const b of [chartB, chartBUnknown, chartBRange, chartBApprox]) {
      const built = build(b);
      const json = JSON.stringify({
        ...built,
        claims: {
          signs: [...built.claims.signs],
          aspects: [...built.claims.aspects],
          houses: [...built.claims.houses],
        },
      });
      for (const input of [colombo, london])
        for (const s of birthStrings(input)) expect(json).not.toContain(s);
    }
  });
});

describe("buildNatalFacts", () => {
  const facts = buildNatalFacts(chartA);

  it("writes each placement with degree, house and retrograde", () => {
    for (const p of chartA.placements) {
      const sign = capital(p.sign);
      const line = facts.lines.find((l) =>
        l.startsWith(`${capital(p.body)} in ${sign}`),
      );
      expect(line).toBeDefined();
      expect(line).toContain(`${Math.floor(p.degree)}°`);
      if (p.house) expect(line).toContain(`, ${p.house}`);
      if (p.retrograde) expect(line).toMatch(/, retrograde$/);
      else expect(line).not.toContain("retrograde");
    }
  });

  it("includes the Ascendant and Midheaven", () => {
    expect(facts.lines.some((l) => l.startsWith("Ascendant in "))).toBe(true);
    expect(facts.lines.some((l) => l.startsWith("Midheaven in "))).toBe(true);
  });

  it("writes each aspect with its orb", () => {
    const a = chartA.aspects[0];
    expect(facts.lines).toContain(
      `${capital(a.a)} ${word(a.type)} ${capital(a.b)} (orb ${a.orb.toFixed(1)}°)`,
    );
  });

  it("words natal conjunctions and oppositions as conjunct and opposite", () => {
    const custom = buildNatalFacts({
      ...chartA,
      aspects: [
        { a: "sun", b: "moon", type: "conjunction", orb: 2.1, applying: null },
        { a: "venus", b: "mars", type: "opposition", orb: 0.4, applying: null },
        { a: "sun", b: "mars", type: "trine", orb: 1, applying: null },
      ],
    });
    expect(custom.lines).toContain("Sun conjunct Moon (orb 2.1°)");
    expect(custom.lines).toContain("Venus opposite Mars (orb 0.4°)");
    expect(custom.lines).toContain("Sun trine Mars (orb 1.0°)");
  });

  it("has a single owner, a, with no aliases", () => {
    expect(facts.claims.owners).toEqual({
      a: {
        aliases: [],
        signs: facts.claims.signs,
        houses: facts.claims.houses,
      },
    });
  });

  it("claims what it lists", () => {
    const sun = chartA.placements.find((p) => p.body === "sun")!;
    expect(facts.claims.signs.has(`sun:${sun.sign}`)).toBe(true);
    expect(facts.claims.houses.has(`sun:${sun.house}`)).toBe(true);
    const a = chartA.aspects[0];
    expect(
      facts.claims.aspects.has([a.a, a.b].sort().join("|") + `|${a.type}`),
    ).toBe(true);
    expect(facts.claims.signs.has(`midheaven:${chartA.midheaven!.sign}`)).toBe(
      true,
    );
    expect(facts.notes).toEqual([]);
  });

  it("omits the house when houses are unavailable and explains the Moon", () => {
    const unknown = buildNatalFacts(chartBRange);
    expect(unknown.lines.some((l) => l.startsWith("Ascendant"))).toBe(false);
    expect(unknown.lines.some((l) => /house/.test(l))).toBe(false);
    const moonLine = unknown.lines.find((l) => l.startsWith("Moon in "))!;
    expect(moonLine).not.toContain("°");
    expect(unknown.notes).toHaveLength(1);
    expect(unknown.notes[0]).toMatch(/birth time is unknown/i);
    expect(unknown.notes[0]).toMatch(/no houses or Ascendant/);
    for (const sign of chartBRange.uncertainty.moonSigns!) {
      expect(unknown.claims.signs.has(`moon:${sign}`)).toBe(true);
      expect(unknown.notes[0]).toContain(capital(sign));
    }
    expect(unknown.claims.houses.size).toBe(0);
  });

  it("explains an unknown birth time when the Moon keeps its sign", () => {
    const steady = buildNatalFacts(chartBUnknown);
    expect(steady.notes).toEqual([
      "The birth time is unknown, so there are no houses or Ascendant.",
    ]);
    expect(steady.lines.find((l) => l.startsWith("Moon in "))).toBe(
      "Moon in Leo",
    );
  });

  it("notes an approximate birth time and claims each Ascendant sign", () => {
    const approx = buildNatalFacts(chartBAscRange);
    const signs = chartBAscRange.uncertainty.ascendantSigns!;
    expect(approx.notes).toHaveLength(1);
    expect(approx.notes[0]).toMatch(/approximate/i);
    for (const s of signs) {
      expect(approx.claims.signs.has(`ascendant:${s}`)).toBe(true);
      expect(approx.notes[0]).toContain(capital(s));
    }
    expect(approx.lines.find((l) => l.startsWith("Ascendant in "))).toBe(
      `Ascendant in ${signs.map(capital).join(" or ")}`,
    );
  });

  it("contains no birth input", () => {
    for (const [chart, input] of [
      [chartA, colombo],
      [chartBUnknown, london],
      [chartBRange, london],
      [chartBApprox, london],
      [chartBAscRange, london],
    ] as const) {
      const json = JSON.stringify(buildNatalFacts(chart));
      for (const s of birthStrings(input)) expect(json).not.toContain(s);
    }
  });
});
