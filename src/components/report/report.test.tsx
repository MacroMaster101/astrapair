import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REPORT_SECTIONS,
  type ReportInterpretation,
  type ReportSectionKey,
} from "@/lib/ai/report-schema";
import type { StoredReport } from "@/lib/report/service";

const generate = vi.hoisted(() => vi.fn());
vi.mock("@/app/(app)/partner/report/actions", () => ({
  generateReportAction: generate,
}));
// The service module is server-only; only its types are used here.
vi.mock("server-only", () => ({}));

import { ASTROLOGY_DISCLAIMER } from "@/lib/legal-documents";
import { Disclaimer } from "./disclaimer";
import { GenerateReportButton } from "./generate-report-button";
import { ReportCard } from "./report-card";
import { ReportView } from "./report-view";

const OUT_OF_DATE =
  "One of you changed birth details, so this report may be out of date.";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function interpretation(): ReportInterpretation {
  const sections = {} as ReportInterpretation["sections"];
  for (const { key, title } of REPORT_SECTIONS) {
    sections[key as ReportSectionKey] = {
      summary: `Summary for ${title}`,
      body: `First paragraph of ${title}.\n\nSecond paragraph of ${title}.`,
      evidence: [],
    };
  }
  sections.overview.evidence = ["e1", "e2", "gone"];
  sections.emotional.evidence = ["e2"];
  return {
    sections,
    reflectionQuestions: [
      "What do we each need to feel safe?",
      "How do we repair after an argument?",
      "What do we want to grow together?",
    ],
  };
}

function storedReport(overrides: Partial<StoredReport> = {}): StoredReport {
  return {
    interpretation: interpretation(),
    evidence: [
      { id: "e1", label: "Sam's Venus trines Alex's Mars" },
      { id: "e2", label: "Sam's Moon is in Cancer" },
    ],
    notes: ["Alex's birth time is unknown, so their Moon is left out."],
    names: { a: "Alex", b: "Sam" },
    completedAt: "2026-09-30T10:00:00Z",
    promptVersion: "report-v1",
    model: "llama3.1:8b",
    ...overrides,
  };
}

describe("Disclaimer", () => {
  it("shows the exact text", () => {
    render(<Disclaimer />);
    expect(
      screen.getByText(
        "For reflection and entertainment. Astrology isn't a substitute for professional advice.",
      ),
    ).toBeTruthy();
  });

  it("shows the shared disclaimer constant", () => {
    render(<Disclaimer />);
    expect(screen.getByText(ASTROLOGY_DISCLAIMER)).toBeTruthy();
  });
});

describe("GenerateReportButton", () => {
  it("shows a busy label while the report is created", async () => {
    let finish!: () => void;
    generate.mockImplementationOnce(
      () => new Promise((resolve) => (finish = () => resolve({}))),
    );
    render(<GenerateReportButton label="Create our report" />);
    fireEvent.click(screen.getByRole("button", { name: "Create our report" }));
    const busy = await screen.findByRole("button", {
      name: "Creating your report...",
    });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toBe(
      "This can take a few minutes. You can leave this page and come back.",
    );
    finish();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Create our report" }),
      ).toBeTruthy(),
    );
  });

  it("keeps an empty status region while idle", () => {
    render(<GenerateReportButton label="Create our report" />);
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("shows the error the action returns", async () => {
    generate.mockResolvedValueOnce({
      error: "The AI assistant is offline right now. Try again later.",
    });
    render(<GenerateReportButton label="Try again" />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "The AI assistant is offline right now. Try again later.",
    );
  });
});

describe("ReportCard", () => {
  it("offers to create a report when there is none", () => {
    render(<ReportCard state={{ kind: "none" }} />);
    expect(
      screen.getByRole("heading", { name: "Compatibility report" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Create a reading of your relationship from both charts.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Create our report" }),
    ).toBeTruthy();
  });

  it("says the report is being created and offers a refresh link", () => {
    render(<ReportCard state={{ kind: "generating" }} />);
    expect(
      screen.getByText(
        "Your report is being created. This can take a minute or two.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Refresh" }).getAttribute("href"),
    ).toBe("/partner");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("links to a ready report without a refresh when it is current", () => {
    render(
      <ReportCard
        state={{ kind: "ready", outOfDate: false, report: storedReport() }}
      />,
    );
    expect(screen.getByText("Your report is ready")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Read your report" })
        .getAttribute("href"),
    ).toBe("/partner/report");
    expect(screen.queryByText(OUT_OF_DATE)).toBeNull();
    expect(screen.queryByRole("button", { name: "Refresh report" })).toBeNull();
  });

  it("warns and offers a refresh when the report is out of date", () => {
    render(
      <ReportCard
        state={{ kind: "ready", outOfDate: true, report: storedReport() }}
      />,
    );
    expect(screen.getByText(OUT_OF_DATE)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh report" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Read your report" })).toBeTruthy();
  });

  it("offers to try again after a failure", () => {
    render(<ReportCard state={{ kind: "failed" }} />);
    expect(screen.getByText("We couldn't create your report.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("shows load error copy when the report is unavailable", () => {
    render(<ReportCard state={{ kind: "unavailable" }} />);
    expect(screen.getByRole("alert").textContent).toBe(
      "We couldn't load your report. Try again.",
    );
    expect(
      screen.getByRole("link", { name: "Reload" }).getAttribute("href"),
    ).toBe("/partner");
  });

  it("renders nothing while charts are missing", () => {
    const { container } = render(
      <ReportCard state={{ kind: "waiting_for_charts" }} />,
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("ReportView", () => {
  it("shows the heading, names, date and version line", () => {
    render(<ReportView report={storedReport()} outOfDate={false} />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Your compatibility report",
      }),
    ).toBeTruthy();
    expect(screen.getByText("Alex and Sam")).toBeTruthy();
    expect(screen.getByText(/Sep 30, 2026/)).toBeTruthy();
    expect(
      screen.getByText("Version report-v1 · model llama3.1:8b"),
    ).toBeTruthy();
  });

  it("renders all nine sections with a summary and a paragraph per blank line", () => {
    render(<ReportView report={storedReport()} outOfDate={false} />);
    expect(REPORT_SECTIONS).toHaveLength(9);
    for (const { title } of REPORT_SECTIONS) {
      const region = screen.getByRole("region", { name: title });
      expect(within(region).getByRole("heading", { name: title })).toBeTruthy();
      expect(within(region).getByText(`Summary for ${title}`)).toBeTruthy();
      expect(
        within(region).getByText(`First paragraph of ${title}.`),
      ).toBeTruthy();
      expect(
        within(region).getByText(`Second paragraph of ${title}.`),
      ).toBeTruthy();
    }
  });

  it("lists stored evidence labels in a details element and skips unknown ids", () => {
    render(<ReportView report={storedReport()} outOfDate={false} />);
    const overview = screen.getByRole("region", {
      name: "Relationship overview",
    });
    const details = overview.querySelector("details")!;
    expect(within(details).getByText("Chart evidence (2)")).toBeTruthy();
    expect(
      within(details).getByText("Sam's Venus trines Alex's Mars"),
    ).toBeTruthy();
    expect(within(details).getByText("Sam's Moon is in Cancer")).toBeTruthy();
    expect(within(details).queryByText("gone")).toBeNull();
    const emotional = screen.getByRole("region", {
      name: "Emotional dynamics",
    });
    expect(within(emotional).getByText("Chart evidence (1)")).toBeTruthy();
  });

  it("hides the evidence details when a section has none", () => {
    render(<ReportView report={storedReport()} outOfDate={false} />);
    const communication = screen.getByRole("region", { name: "Communication" });
    expect(communication.querySelector("details")).toBeNull();
    // An id with no stored label does not count either.
    const report = storedReport();
    report.interpretation.sections.attraction.evidence = ["gone"];
    cleanup();
    render(<ReportView report={report} outOfDate={false} />);
    expect(
      screen
        .getByRole("region", { name: "Attraction" })
        .querySelector("details"),
    ).toBeNull();
  });

  it("lists the reflection questions in order", () => {
    render(<ReportView report={storedReport()} outOfDate={false} />);
    const section = screen.getByRole("region", {
      name: "Questions to reflect on",
    });
    const items = within(section).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "What do we each need to feel safe?",
      "How do we repair after an argument?",
      "What do we want to grow together?",
    ]);
    expect(section.querySelector("ol")).toBeTruthy();
  });

  it("shows notes, and omits the box when there are none", () => {
    render(<ReportView report={storedReport()} outOfDate={false} />);
    expect(
      within(screen.getByLabelText("Notes about this report")).getByText(
        "Alex's birth time is unknown, so their Moon is left out.",
      ),
    ).toBeTruthy();
    cleanup();
    render(
      <ReportView report={storedReport({ notes: [] })} outOfDate={false} />,
    );
    expect(screen.queryByLabelText("Notes about this report")).toBeNull();
  });

  it("shows the disclaimer and a way back", () => {
    render(<ReportView report={storedReport()} outOfDate={false} />);
    expect(
      screen.getByText(
        "For reflection and entertainment. Astrology isn't a substitute for professional advice.",
      ),
    ).toBeTruthy();
    const links = screen.getAllByRole("link", { name: /Back to your partner/ });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links)
      expect(link.getAttribute("href")).toBe("/partner");
  });

  it("shows the out-of-date note and refresh button only when out of date", () => {
    render(<ReportView report={storedReport()} outOfDate />);
    expect(screen.getByText(OUT_OF_DATE)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh report" })).toBeTruthy();
    cleanup();
    render(<ReportView report={storedReport()} outOfDate={false} />);
    expect(screen.queryByText(OUT_OF_DATE)).toBeNull();
    expect(screen.queryByRole("button", { name: "Refresh report" })).toBeNull();
  });

  it("shows a banner near the top, before the sections, only when out of date", () => {
    render(<ReportView report={storedReport()} outOfDate />);
    const banner = screen.getByLabelText("Report status");
    expect(banner.textContent).toContain("This report may be out of date.");
    expect(
      within(banner)
        .getByRole("link", { name: "Refresh it below" })
        .getAttribute("href"),
    ).toBe("#out-of-date-heading");
    const firstSection = screen.getByRole("region", {
      name: "Relationship overview",
    });
    expect(
      banner.compareDocumentPosition(firstSection) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The note and the refresh button stay at the bottom, where the link points.
    expect(document.getElementById("out-of-date-heading")).toBeTruthy();
    cleanup();
    render(<ReportView report={storedReport()} outOfDate={false} />);
    expect(screen.queryByLabelText("Report status")).toBeNull();
  });

  it("renders model text as plain text, never as markup", () => {
    const report = storedReport();
    report.interpretation.sections.overview.summary =
      "<b>Bold</b> <script>x</script>";
    const { container } = render(
      <ReportView report={report} outOfDate={false} />,
    );
    expect(screen.getByText("<b>Bold</b> <script>x</script>")).toBeTruthy();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("section b")).toBeNull();
  });
});
