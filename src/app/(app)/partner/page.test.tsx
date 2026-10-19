import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOnboardedUserId: vi.fn(async () => "user-1"),
  getPartnerState: vi.fn(),
  getReportState: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({
  requireOnboardedUserId: mocks.requireOnboardedUserId,
}));
vi.mock("@/lib/partner/service", () => ({
  getPartnerState: mocks.getPartnerState,
}));
vi.mock("@/lib/report/service", () => ({
  getReportState: mocks.getReportState,
}));

import { ConnectedView } from "@/components/partner/connected-view";
import PartnerPage from "./page";

type Element = { type: unknown; props: { reportState?: unknown } };

const connected = { kind: "connected" } as never;

afterEach(() => vi.restoreAllMocks());

/** The connected view's element, found in the page's returned tree. */
function connectedView(tree: unknown): Element {
  const page = tree as { props: { children: unknown[] } };
  const found = page.props.children.find(
    (c) => (c as Element | null)?.type === ConnectedView,
  );
  return found as Element;
}

describe("PartnerPage report state", () => {
  it("passes the report state through without logging", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getPartnerState.mockResolvedValue(connected);
    mocks.getReportState.mockResolvedValue({ kind: "none" });
    const view = connectedView(await PartnerPage());
    expect(view.props.reportState).toEqual({ kind: "none" });
    expect(error).not.toHaveBeenCalled();
  });

  it("falls back to unavailable and logs a fixed message with no details", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getPartnerState.mockResolvedValue(connected);
    mocks.getReportState.mockRejectedValue(
      new Error("secret: Sam was born in Colombo"),
    );
    const view = connectedView(await PartnerPage());
    expect(view.props.reportState).toEqual({ kind: "unavailable" });
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("Report state failed", {
      stage: "partner-page",
      code: "exception",
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain("Colombo");
  });
});
