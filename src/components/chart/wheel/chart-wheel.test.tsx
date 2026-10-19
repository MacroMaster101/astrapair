import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { BuiltInProvider } from "@/lib/astrology/engine";
import { signLabel } from "@/lib/astrology/interpretations";
import {
  BODIES,
  type BirthInput,
  type NatalChart,
} from "@/lib/astrology/types";
import { ChartWheel } from "./chart-wheel";

const provider = new BuiltInProvider();

const colombo: BirthInput = {
  birthDate: "1990-07-15",
  birthTime: "12:00",
  accuracy: "exact",
  latitude: 6.93548,
  longitude: 79.84868,
  timezone: "Asia/Colombo",
};

const exactChart = provider.calculateNatalChart(colombo);
const unknownChart = provider.calculateNatalChart({
  ...colombo,
  birthTime: null,
  accuracy: "unknown",
});
const polarChart = provider.calculateNatalChart({
  ...colombo,
  latitude: 69.6496,
  longitude: 18.956,
  timezone: "Europe/Oslo",
});

const unknownWithMoonAspect: NatalChart = {
  ...unknownChart,
  aspects: [
    ...unknownChart.aspects.filter((a) => a.a !== "moon" && a.b !== "moon"),
    { a: "moon", b: "sun", type: "trine", orb: 2, applying: true },
  ],
};

const sunSign = (chart: NatalChart) =>
  signLabel(chart.placements.find((p) => p.body === "sun")!.sign);

const isAngle = (point: string) =>
  point === "ascendant" || point === "midheaven";

/** Lines join planets only, and conjunctions get no line. */
const drawable = (chart: NatalChart) =>
  chart.aspects.filter(
    (a) => a.type !== "conjunction" && !isAngle(a.a) && !isAngle(a.b),
  );

const all = (container: HTMLElement, part: string) => [
  ...container.querySelectorAll(`[data-wheel="${part}"]`),
];

const labels = (container: HTMLElement) =>
  all(container, "axis-label").map((el) => el.textContent);

afterEach(cleanup);

describe.each([
  ["exact time", exactChart],
  ["polar latitude", polarChart],
])("ChartWheel with a known birth time (%s)", (_name, chart) => {
  it("draws twelve sign glyphs and ten planets", () => {
    const { container } = render(<ChartWheel chart={chart} />);
    expect(all(container, "sign-glyph")).toHaveLength(12);
    expect(all(container, "planet")).toHaveLength(10);
    expect(
      all(container, "planet").map((el) => el.getAttribute("data-body")),
    ).toEqual([...BODIES]);
  });

  it("draws twelve house lines, twelve house numbers and the four axes", () => {
    const { container } = render(<ChartWheel chart={chart} />);
    expect(all(container, "house-line")).toHaveLength(12);
    expect(all(container, "house-number").map((el) => el.textContent)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
    ]);
    expect(labels(container).sort()).toEqual(["ASC", "DSC", "IC", "MC"]);
  });

  it("draws one chord for every planet aspect except conjunctions", () => {
    const { container } = render(<ChartWheel chart={chart} />);
    const expected = drawable(chart);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(chart.aspects.length);
    const chords = all(container, "chord");
    expect(chords).toHaveLength(expected.length);
    expect(
      chords.map(
        (c) => `${c.getAttribute("data-a")}-${c.getAttribute("data-b")}`,
      ),
    ).toEqual(expected.map((a) => `${a.a}-${a.b}`));
  });

  it("fills the Moon and shows no unknown-time caption", () => {
    const { container } = render(<ChartWheel chart={chart} />);
    expect(container.querySelector('[data-hollow="true"]')).toBeNull();
    expect(container.textContent).not.toContain(
      "Houses and rising sign need your birth time.",
    );
  });

  it("produces clean markup", () => {
    const html = renderToStaticMarkup(<ChartWheel chart={chart} />);
    expect(html).not.toMatch(/NaN|undefined|Infinity/);
  });
});

describe("ChartWheel with an unknown birth time", () => {
  it("still draws twelve sign glyphs and ten planets", () => {
    const { container } = render(<ChartWheel chart={unknownChart} />);
    expect(all(container, "sign-glyph")).toHaveLength(12);
    expect(all(container, "planet")).toHaveLength(10);
  });

  it("draws no houses, axes or angle labels", () => {
    const { container } = render(<ChartWheel chart={unknownChart} />);
    expect(all(container, "house-line")).toHaveLength(0);
    expect(all(container, "house-number")).toHaveLength(0);
    expect(all(container, "axis")).toHaveLength(0);
    expect(labels(container)).toEqual([]);
    expect(container.querySelector("svg")!.textContent).not.toMatch(/ASC|MC/);
  });

  it("draws the Moon as an outline and only the Moon", () => {
    const { container } = render(<ChartWheel chart={unknownChart} />);
    const hollow = [...container.querySelectorAll('[data-hollow="true"]')];
    expect(hollow).toHaveLength(1);
    expect(hollow[0].getAttribute("data-body")).toBe("moon");
    expect(hollow[0].getAttribute("fill")).toBe("none");
  });

  it("explains what is missing under the wheel", () => {
    const { container } = render(<ChartWheel chart={unknownChart} />);
    expect(container.textContent).toContain(
      "Houses and rising sign need your birth time.",
    );
    expect(container.textContent).toMatch(/Moon is drawn as an outline/);
  });

  it("says the Moon may be in one of two signs when it changed sign", () => {
    const { container } = render(
      <ChartWheel
        chart={{
          ...unknownChart,
          uncertainty: {
            ...unknownChart.uncertainty,
            moonSigns: ["cancer", "leo"],
          },
        }}
      />,
    );
    expect(container.textContent).toMatch(/one of two/);
    expect(
      container.querySelector('[data-body="moon"] title')!.textContent,
    ).toBe("Moon in Cancer or Leo");
  });

  it("draws no chord that touches the Moon", () => {
    const { container } = render(<ChartWheel chart={unknownWithMoonAspect} />);
    const chords = all(container, "chord");
    const expected = drawable(unknownWithMoonAspect).filter(
      (a) => a.a !== "moon" && a.b !== "moon",
    );
    expect(expected.length).toBeLessThan(
      drawable(unknownWithMoonAspect).length,
    );
    expect(chords).toHaveLength(expected.length);
    for (const chord of chords) {
      expect(chord.getAttribute("data-a")).not.toBe("moon");
      expect(chord.getAttribute("data-b")).not.toBe("moon");
    }
  });

  it("produces clean markup", () => {
    const html = renderToStaticMarkup(<ChartWheel chart={unknownChart} />);
    expect(html).not.toMatch(/NaN|undefined|Infinity/);
  });
});

describe("ChartWheel accessibility", () => {
  it("is an image labelled with the Big Three", () => {
    const { container } = render(<ChartWheel chart={exactChart} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    const label = svg.getAttribute("aria-label")!;
    expect(label).toMatch(/^Birth chart wheel\. /);
    expect(label).toContain(`Sun in ${sunSign(exactChart)}`);
    expect(label).toContain(
      `Ascendant in ${signLabel(exactChart.ascendant!.sign)}`,
    );
    expect(svg.querySelector(":scope > title")).toBeTruthy();
    expect(svg.querySelector(":scope > desc")).toBeTruthy();
  });

  it("uses the unknown-time wording in the label", () => {
    const { container } = render(<ChartWheel chart={unknownChart} />);
    const label = container.querySelector("svg")!.getAttribute("aria-label")!;
    expect(label).toContain(`Sun in ${sunSign(unknownChart)}`);
    expect(label).toContain("Ascendant needs a birth time");
  });

  it("gives every planet a plain tooltip with its sign", () => {
    const { container } = render(<ChartWheel chart={exactChart} />);
    for (const p of exactChart.placements) {
      const title = container.querySelector(
        `[data-wheel="planet"][data-body="${p.body}"] > title`,
      )!;
      expect(title.textContent).toContain(signLabel(p.sign));
      expect(title.textContent).toMatch(/\d+ degrees, \d+(st|nd|rd|th) house/);
      expect(title.textContent!.endsWith(", retrograde")).toBe(p.retrograde);
    }
  });

  it("sits in a labelled section with a legend", () => {
    const { container } = render(<ChartWheel chart={exactChart} />);
    const section = container.querySelector("section")!;
    const heading = container.querySelector("h2")!;
    expect(heading.textContent).toBe("Your chart wheel");
    expect(section.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(container.textContent).toMatch(/easy aspects \(trine, sextile\)/);
    expect(container.textContent).toMatch(
      /tense aspects \(square, opposition\)/,
    );
  });
});
