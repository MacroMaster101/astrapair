import {
  SIGNS,
  type Aspect,
  type ChartPoint,
  type NatalChart,
  type Placement,
} from "@/lib/astrology/types";
import {
  ASPECT_LABELS,
  bodyLabel,
  formatDegree,
  ordinal,
  pointLabel,
  signLabel,
} from "@/lib/astrology/interpretations";
import { bigThreeSigns } from "../big-three-values";
import { declutter, normalizeDegrees, polar, wheelAngle } from "./geometry";
import {
  BODY_GLYPHS,
  GLYPH_FONT_FAMILY,
  MOON_PATH,
  SIGN_ELEMENTS,
  SIGN_GLYPHS,
  type Element,
} from "./glyphs";

/** Planets closer than this are fanned apart so their glyphs do not overlap. */
export const MIN_PLANET_SEPARATION_DEG = 9;

/** Orb at which an aspect line fades to its faintest. */
const FAINTEST_ORB_DEG = 8;

const SIZE = 600;
const CENTER = SIZE / 2;

/** Ring radii in viewBox units, from the outside in. */
const RADIUS = {
  axisLabel: 285,
  axisStub: 275,
  outer: 268,
  signGlyph: 248,
  signInner: 228,
  planetTick: 222,
  planetLeader: 216,
  planetGlyph: 199,
  planetDegree: 174,
  planetRetrograde: 155,
  houseOuter: 147,
  houseNumber: 137.5,
  aspect: 128,
} as const;

const SIGN_GLYPH_SIZE = 27;
const PLANET_GLYPH_SIZE = 28;

/**
 * Element colours are scoped to the wheel. Each one keeps at least 3:1
 * contrast against its own tint on the card in both themes.
 */
const ELEMENT_PALETTE =
  "[--wheel-fire:#b4380b] [--wheel-earth:#177a3c] [--wheel-air:#8a5700] [--wheel-water:var(--primary)] dark:[--wheel-fire:#ff9a6c] dark:[--wheel-earth:#5fd68b] dark:[--wheel-air:#f2c94c] dark:[--wheel-water:#8fb0ff]";

const ELEMENT_COLOR: Record<Element, string> = {
  fire: "var(--wheel-fire)",
  earth: "var(--wheel-earth)",
  air: "var(--wheel-air)",
  water: "var(--wheel-water)",
};

const TENSE_ASPECTS = new Set<Aspect["type"]>(["square", "opposition"]);

/** Two decimals is plenty for a 600 unit canvas and keeps the markup small. */
const round = (value: number) => Math.round(value * 100) / 100;

const lowerFirst = (text: string) =>
  text.charAt(0).toLowerCase() + text.slice(1);

export function ChartWheel({ chart }: { chart: NatalChart }) {
  const timeUnknown = chart.uncertainty.timeAccuracy === "unknown";
  // Without a birth time there is no Ascendant, so Aries 0 sits on the left.
  const origin = chart.ascendant?.longitude ?? 0;
  const at = (radius: number, longitude: number) => {
    const p = polar(CENTER, CENTER, radius, wheelAngle(longitude, origin));
    return { x: round(p.x), y: round(p.y) };
  };

  const moonSigns = chart.uncertainty.moonSigns;
  const moonRange =
    timeUnknown && moonSigns && moonSigns.length > 1
      ? moonSigns.map(signLabel).join(" or ")
      : null;
  // Without a birth time the Moon's position is only known to the day.
  const isUncertainMoon = (p: Placement) => timeUnknown && p.body === "moon";

  const bigThree = bigThreeSigns(chart);
  const summary = `Birth chart wheel. Sun in ${bigThree.sun}, Moon in ${bigThree.moon}, ${
    chart.ascendant
      ? `Ascendant in ${bigThree.ascendant}`
      : `Ascendant ${lowerFirst(bigThree.ascendant)}`
  }.`;

  const axes =
    chart.ascendant && chart.midheaven
      ? [
          { label: "ASC", longitude: chart.ascendant.longitude },
          { label: "DSC", longitude: chart.ascendant.longitude + 180 },
          { label: "MC", longitude: chart.midheaven.longitude },
          { label: "IC", longitude: chart.midheaven.longitude + 180 },
        ]
      : [];

  // The axes take part in the fan-out so a planet sitting on the horizon or
  // the meridian is nudged clear of the line, on its own side of it.
  const display = new Map(
    declutter(
      [
        ...chart.placements.map((p) => ({
          id: p.body as string,
          longitude: p.longitude,
        })),
        ...axes.map((a) => ({
          id: `axis-${a.label}`,
          longitude: a.longitude,
          fixed: true,
        })),
      ],
      MIN_PLANET_SEPARATION_DEG,
    ).map((p) => [p.id, p.displayLongitude]),
  );

  // The Ascendant and Midheaven already have their own axis lines, so lines
  // join planets only. Aspects to the angles stay in the aspect list.
  const pointLongitude = (point: ChartPoint): number | null =>
    chart.placements.find((p) => p.body === point)?.longitude ?? null;

  // Same rule as the aspect list: no Moon aspects without a birth time.
  // Conjunctions get no line because the planets already sit together.
  const chords = chart.aspects.flatMap((aspect) => {
    if (aspect.type === "conjunction") return [];
    if (timeUnknown && (aspect.a === "moon" || aspect.b === "moon")) return [];
    const from = pointLongitude(aspect.a);
    const to = pointLongitude(aspect.b);
    if (from === null || to === null) return [];
    return [{ aspect, from, to }];
  });

  const houses = chart.houses ?? [];
  const anyRetrograde = chart.placements.some((p) => p.retrograde);

  return (
    <section aria-labelledby="chart-wheel" className="grid gap-4">
      <h2 id="chart-wheel" className="text-xl font-semibold">
        Your chart wheel
      </h2>
      <figure className="bg-card grid gap-4 rounded-2xl border p-2 sm:p-5">
        <svg
          role="img"
          aria-label={summary}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className={`mx-auto h-auto w-full max-w-[640px] ${ELEMENT_PALETTE}`}
        >
          <title>Birth chart wheel</title>
          <desc>
            {`${summary} The outer ring shows the twelve zodiac signs. Inside it are the planets at their positions${
              houses.length > 0 ? ", the twelve houses" : ""
            } and lines between planets that form aspects. The lists on this page give the same details as text.`}
          </desc>

          {/* 1. Sign ring */}
          <g data-wheel="signs">
            {SIGNS.map((sign, i) => {
              const start = i * 30;
              const outerStart = at(RADIUS.outer, start);
              const outerEnd = at(RADIUS.outer, start + 30);
              const innerEnd = at(RADIUS.signInner, start + 30);
              const innerStart = at(RADIUS.signInner, start);
              const glyph = at(RADIUS.signGlyph, start + 15);
              const color = ELEMENT_COLOR[SIGN_ELEMENTS[sign]];
              return (
                <g key={sign}>
                  <title>{signLabel(sign)}</title>
                  <path
                    d={`M${outerStart.x} ${outerStart.y}A${RADIUS.outer} ${RADIUS.outer} 0 0 0 ${outerEnd.x} ${outerEnd.y}L${innerEnd.x} ${innerEnd.y}A${RADIUS.signInner} ${RADIUS.signInner} 0 0 1 ${innerStart.x} ${innerStart.y}Z`}
                    style={{ fill: color }}
                    fillOpacity={0.16}
                  />
                  <text
                    data-wheel="sign-glyph"
                    x={glyph.x}
                    y={glyph.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={SIGN_GLYPH_SIZE}
                    style={{ fill: color, fontFamily: GLYPH_FONT_FAMILY }}
                  >
                    {SIGN_GLYPHS[sign]}
                  </text>
                </g>
              );
            })}
          </g>

          {/* 2. Ring outlines and degree ticks */}
          <g
            className="text-muted-foreground stroke-current"
            fill="none"
            strokeWidth={1}
          >
            <circle cx={CENTER} cy={CENTER} r={RADIUS.outer} />
            <circle cx={CENTER} cy={CENTER} r={RADIUS.signInner} />
            {houses.length > 0 && (
              <circle
                cx={CENTER}
                cy={CENTER}
                r={RADIUS.houseOuter}
                strokeOpacity={0.5}
              />
            )}
            <circle cx={CENTER} cy={CENTER} r={RADIUS.aspect} />
            {Array.from({ length: 72 }, (_, i) => i * 5).map((longitude) => {
              const boundary = longitude % 30 === 0;
              const from = at(
                boundary ? RADIUS.outer : RADIUS.signInner,
                longitude,
              );
              const to = at(
                RADIUS.signInner -
                  (boundary ? 8 : longitude % 10 === 0 ? 5 : 3),
                longitude,
              );
              return (
                <line
                  key={longitude}
                  data-wheel="tick"
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  strokeOpacity={boundary ? 1 : 0.6}
                />
              );
            })}
          </g>

          {/* 3. Houses */}
          {houses.length > 0 && (
            <g data-wheel="houses">
              <g
                className="text-muted-foreground stroke-current"
                strokeWidth={1}
                strokeOpacity={0.55}
              >
                {houses.map((h) => {
                  const from = at(RADIUS.aspect, h.longitude);
                  const to = at(RADIUS.signInner, h.longitude);
                  return (
                    <line
                      key={h.house}
                      data-wheel="house-line"
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                    />
                  );
                })}
              </g>
              <g
                className="fill-muted-foreground"
                fontSize={13}
                textAnchor="middle"
              >
                {houses.map((h, i) => {
                  const next = houses[(i + 1) % houses.length];
                  const span = normalizeDegrees(next.longitude - h.longitude);
                  const middle = at(RADIUS.houseNumber, h.longitude + span / 2);
                  return (
                    <text
                      key={h.house}
                      data-wheel="house-number"
                      x={middle.x}
                      y={middle.y}
                      dominantBaseline="central"
                    >
                      {h.house}
                    </text>
                  );
                })}
              </g>
            </g>
          )}

          {/* Axes: the horizon and the meridian */}
          {axes.length > 0 && (
            <g data-wheel="axes">
              <g className="text-foreground stroke-current" strokeWidth={2}>
                {axes.map((axis) => {
                  const from = at(RADIUS.aspect, axis.longitude);
                  const to = at(RADIUS.signInner, axis.longitude);
                  const stubFrom = at(RADIUS.outer, axis.longitude);
                  const stubTo = at(RADIUS.axisStub, axis.longitude);
                  return (
                    <g key={axis.label} data-wheel="axis">
                      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
                      <line
                        x1={stubFrom.x}
                        y1={stubFrom.y}
                        x2={stubTo.x}
                        y2={stubTo.y}
                      />
                    </g>
                  );
                })}
              </g>
              <g
                className="fill-foreground"
                fontSize={12}
                fontWeight={700}
                textAnchor="middle"
              >
                {axes.map((axis) => {
                  const label = at(RADIUS.axisLabel, axis.longitude);
                  return (
                    <text
                      key={axis.label}
                      data-wheel="axis-label"
                      x={label.x}
                      y={label.y}
                      dominantBaseline="central"
                    >
                      {axis.label}
                    </text>
                  );
                })}
              </g>
            </g>
          )}

          {/* 5. Aspect lines, kept quiet so the glyphs stay readable */}
          <g data-wheel="aspects" fill="none" strokeLinecap="round">
            {chords.map(({ aspect, from, to }) => {
              const tense = TENSE_ASPECTS.has(aspect.type);
              const tightness = Math.max(
                0,
                Math.min(1, 1 - aspect.orb / FAINTEST_ORB_DEG),
              );
              const a = at(RADIUS.aspect, from);
              const b = at(RADIUS.aspect, to);
              return (
                <line
                  key={`${aspect.a}-${aspect.b}`}
                  data-wheel="chord"
                  data-a={aspect.a}
                  data-b={aspect.b}
                  data-aspect={aspect.type}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className={tense ? "stroke-destructive" : "stroke-primary"}
                  strokeWidth={tense ? 2 : 1.3}
                  strokeOpacity={round(0.5 + 0.5 * tightness)}
                >
                  <title>
                    {`${pointLabel(aspect.a)} ${ASPECT_LABELS[aspect.type].toLowerCase()} ${pointLabel(aspect.b)}`}
                  </title>
                </line>
              );
            })}
          </g>

          {/* 4. Planets */}
          <g data-wheel="planets" textAnchor="middle">
            {chart.placements.map((p) => {
              const shown = display.get(p.body) ?? p.longitude;
              const hollow = isUncertainMoon(p);
              const tickFrom = at(RADIUS.signInner, p.longitude);
              const tickTo = at(RADIUS.planetTick, p.longitude);
              const leader = at(RADIUS.planetLeader, shown);
              const anchor = at(RADIUS.aspect, p.longitude);
              const glyph = at(RADIUS.planetGlyph, shown);
              const degree = at(RADIUS.planetDegree, shown);
              const retrograde = at(RADIUS.planetRetrograde, shown);
              const title = hollow
                ? `${bodyLabel(p.body)} in ${moonRange ?? signLabel(p.sign)}`
                : `${bodyLabel(p.body)} in ${signLabel(p.sign)}, ${Math.floor(p.degree)} degrees${
                    p.house ? `, ${ordinal(p.house)} house` : ""
                  }${p.retrograde ? ", retrograde" : ""}`;
              return (
                <g key={p.body} data-wheel="planet" data-body={p.body}>
                  <title>{title}</title>
                  <line
                    x1={tickTo.x}
                    y1={tickTo.y}
                    x2={leader.x}
                    y2={leader.y}
                    className="text-muted-foreground stroke-current"
                    strokeWidth={1}
                  />
                  <line
                    data-wheel="planet-tick"
                    x1={tickFrom.x}
                    y1={tickFrom.y}
                    x2={tickTo.x}
                    y2={tickTo.y}
                    className="text-foreground stroke-current"
                    strokeWidth={1.8}
                  />
                  <circle
                    cx={anchor.x}
                    cy={anchor.y}
                    r={2.4}
                    className="fill-foreground"
                  />
                  {/* Card-coloured backing so house lines do not cut the glyph. */}
                  <circle
                    cx={glyph.x}
                    cy={glyph.y}
                    r={14}
                    className="fill-card"
                  />
                  {p.body === "moon" ? (
                    <path
                      data-body={p.body}
                      data-hollow={hollow ? "true" : undefined}
                      d={MOON_PATH}
                      transform={`translate(${glyph.x} ${glyph.y})`}
                      className="text-foreground stroke-current"
                      fill={hollow ? "none" : "currentColor"}
                      strokeWidth={1.6}
                      strokeLinejoin="round"
                    />
                  ) : (
                    <text
                      x={glyph.x}
                      y={glyph.y}
                      dominantBaseline="central"
                      fontSize={PLANET_GLYPH_SIZE}
                      className="fill-foreground"
                      style={{ fontFamily: GLYPH_FONT_FAMILY }}
                    >
                      {BODY_GLYPHS[p.body]}
                    </text>
                  )}
                  {!hollow && (
                    <text
                      x={degree.x}
                      y={degree.y}
                      dominantBaseline="central"
                      fontSize={15}
                      className="fill-foreground stroke-card"
                      strokeWidth={4}
                      paintOrder="stroke"
                    >
                      {formatDegree(p.degree)}
                    </text>
                  )}
                  {p.retrograde && (
                    <text
                      x={retrograde.x}
                      y={retrograde.y}
                      dominantBaseline="central"
                      fontSize={12}
                      fontWeight={700}
                      className="fill-muted-foreground stroke-card"
                      strokeWidth={3}
                      paintOrder="stroke"
                    >
                      R
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        <figcaption className="text-muted-foreground grid gap-1 px-2 pb-2 text-sm leading-relaxed sm:px-0 sm:pb-0">
          {timeUnknown && (
            <p>
              Houses and rising sign need your birth time. The Moon is drawn as
              an outline because{" "}
              {moonRange
                ? `it changed sign on your birth day, so its sign may be one of two (${moonRange}).`
                : "its exact position depends on your birth time."}
            </p>
          )}
          <p>
            Blue lines: easy aspects (trine, sextile). Red lines: tense aspects
            (square, opposition). Stronger lines are closer aspects.
          </p>
          {anyRetrograde && <p>R marks a retrograde planet.</p>}
        </figcaption>
      </figure>
    </section>
  );
}
