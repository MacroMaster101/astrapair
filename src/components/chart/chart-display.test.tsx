import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BuiltInProvider } from "@/lib/astrology/engine";
import { ASPECT_LABELS } from "@/lib/astrology/interpretations";
import {
  ASPECT_TYPES,
  type BirthInput,
  type NatalChart,
} from "@/lib/astrology/types";
import { AspectList } from "./aspect-list";
import { BigThree } from "./big-three";
import { bigThreeSigns, bigThreeValues } from "./big-three-values";
import { ChartNotes } from "./chart-notes";
import { HouseList } from "./house-list";
import { PlacementList } from "./placement-list";

const provider = new BuiltInProvider();

const exact: BirthInput = {
  birthDate: "1990-07-15",
  birthTime: "12:00",
  accuracy: "exact",
  latitude: 6.93548,
  longitude: 79.84868,
  timezone: "Asia/Colombo",
};

const unknownChart = provider.calculateNatalChart({
  ...exact,
  birthTime: null,
  accuracy: "unknown",
});
const exactChart = provider.calculateNatalChart(exact);
const approxChart = provider.calculateNatalChart({
  ...exact,
  accuracy: "approximate",
});

const unknownWithMoonRange: NatalChart = {
  ...unknownChart,
  uncertainty: { ...unknownChart.uncertainty, moonSigns: ["cancer", "leo"] },
};

const unknownWithMoonAspect: NatalChart = {
  ...unknownChart,
  aspects: [
    ...unknownChart.aspects.filter((a) => a.a !== "moon" && a.b !== "moon"),
    { a: "moon", b: "sun", type: "trine", orb: 2, applying: true },
  ],
};

afterEach(cleanup);

describe("bigThreeValues", () => {
  it("returns a range for the Moon when it changes sign", () => {
    const v = bigThreeValues(unknownWithMoonRange);
    expect(v.moon).toBe("Cancer or Leo");
    expect(v.moonNote).toBeTruthy();
  });

  it("says the Ascendant needs a birth time when there is none", () => {
    expect(bigThreeValues(unknownChart).ascendant).toBe("Needs a birth time");
  });

  it("includes degrees on the chart page and drops them in the summary", () => {
    expect(bigThreeValues(exactChart).sun).toMatch(/°$/);
    expect(bigThreeSigns(exactChart).sun).not.toMatch(/°/);
    expect(bigThreeSigns(unknownWithMoonRange).moon).toBe("Cancer or Leo");
  });

  it("shows no Moon degree when the birth time is unknown", () => {
    expect(bigThreeValues(unknownChart).moon).not.toMatch(/°/);
  });
});

describe("chart display components", () => {
  it("shows that the Ascendant needs a birth time when time is unknown", () => {
    render(<BigThree chart={unknownChart} />);
    expect(screen.getByText("Needs a birth time")).toBeTruthy();
  });

  it("shows the unknown-time note", () => {
    render(<ChartNotes chart={unknownChart} />);
    expect(screen.getByText(/Without a birth time/)).toBeTruthy();
  });

  it("shows the approximate-time note", () => {
    render(<ChartNotes chart={approxChart} />);
    expect(screen.getByText(/Your birth time is approximate/)).toBeTruthy();
  });

  it("renders no houses when time is unknown", () => {
    const { container } = render(<HouseList chart={unknownChart} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows a real Ascendant and no notes for an exact time", () => {
    render(<BigThree chart={exactChart} />);
    expect(screen.queryByText("Needs a birth time")).toBeNull();
    const { container } = render(<ChartNotes chart={exactChart} />);
    expect(container.firstChild).toBeNull();
  });

  it("hides the Moon degree in the planet list when time is unknown", () => {
    const { container } = render(<PlacementList chart={unknownChart} />);
    const rows = [...container.querySelectorAll("li")];
    const moonRow = rows.find((li) => li.textContent?.startsWith("Moon in"));
    expect(moonRow).toBeTruthy();
    expect(moonRow!.querySelector("p")!.textContent).not.toContain("°");
    const sunRow = rows.find((li) => li.textContent?.startsWith("Sun in"));
    expect(sunRow!.querySelector("p")!.textContent).toContain("°");
  });

  it("shows a Moon sign range in the planet list when the Moon changes sign", () => {
    render(<PlacementList chart={unknownWithMoonRange} />);
    expect(screen.getByText(/Moon in Cancer or Leo/)).toBeTruthy();
  });

  it("omits Moon aspects and explains why when time is unknown", () => {
    const { container } = render(<AspectList chart={unknownWithMoonAspect} />);
    expect(container.textContent).not.toMatch(/Moon (trine|square)/i);
    expect(container.textContent).not.toContain("Moon trine Sun");
    expect(
      screen.getByText(/Moon aspects are hidden because the Moon moves/),
    ).toBeTruthy();
  });

  it("groups aspects by type in a fixed order, tightest orb first", () => {
    const { container } = render(<AspectList chart={exactChart} />);
    const headings = [...container.querySelectorAll("h3")].map(
      (h) => h.textContent,
    );
    expect(headings.length).toBeGreaterThan(1);
    const expected = ASPECT_TYPES.map((t) => ASPECT_LABELS[t]).filter((label) =>
      headings.includes(label),
    );
    expect(headings).toEqual(expected);
    for (const list of container.querySelectorAll("ul")) {
      const orbs = [...list.querySelectorAll("li span")].map((el) =>
        Number.parseFloat(el.textContent!.replace("Orb", "")),
      );
      expect(orbs).toEqual([...orbs].sort((a, b) => a - b));
    }
  });

  it("keeps Moon aspects when the time is exact", () => {
    render(<AspectList chart={exactChart} />);
    expect(screen.queryByText(/Moon aspects are hidden/)).toBeNull();
  });
});
