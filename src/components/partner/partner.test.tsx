import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuiltInProvider } from "@/lib/astrology/engine";
import { calculateSynastry } from "@/lib/astrology/synastry";
import type { BirthInput } from "@/lib/astrology/types";
import { summarizeChart, type PartnerState } from "@/lib/partner/service";

const actions = vi.hoisted(() => ({
  createInviteLink: vi.fn(async () => ({})),
  cancelInvite: vi.fn(async () => {}),
  disconnect: vi.fn(async () => ({})),
}));
vi.mock("@/app/(app)/partner/actions", () => actions);
vi.mock("@/app/(app)/partner/report/actions", () => ({
  generateReportAction: vi.fn(async () => ({})),
}));
// The service module is server-only; only its pure summary helper is used here.
vi.mock("server-only", () => ({}));

import { ConnectedView } from "./connected-view";
import { CopyLink } from "./copy-link";
import { DisconnectPanel } from "./disconnect-panel";
import { InvitePanel } from "./invite-panel";
import { InviteSection } from "./invite-section";
import { PendingInvite } from "./pending-invite";

const provider = new BuiltInProvider();
const exact: BirthInput = {
  birthDate: "1990-07-15",
  birthTime: "12:00",
  accuracy: "exact",
  latitude: 6.93548,
  longitude: 79.84868,
  timezone: "Asia/Colombo",
};
const other: BirthInput = {
  birthDate: "1988-02-03",
  birthTime: "06:30",
  accuracy: "exact",
  latitude: 51.5074,
  longitude: -0.1278,
  timezone: "Europe/London",
};

const you = provider.calculateNatalChart(exact);
const knownPartner = provider.calculateNatalChart(other);
const unknownPartner = provider.calculateNatalChart({
  ...other,
  birthTime: null,
  accuracy: "unknown",
});

type Connected = Extract<PartnerState, { kind: "connected" }>;

function connected(overrides: Partial<Connected> = {}): Connected {
  return {
    kind: "connected",
    relationshipId: "0d5b1d3e-6f4a-4a35-9a53-2f6a3f0c8d11",
    connectedAt: "2026-09-20T10:00:00Z",
    you: summarizeChart(you, "Sam"),
    partner: summarizeChart(knownPartner, "Alex"),
    synastry: calculateSynastry(you, knownPartner),
    synastryError: false,
    ...overrides,
  };
}

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("InvitePanel", () => {
  it("asks for consent and offers the create button", () => {
    render(
      <InvitePanel title="Invite your partner" hasPendingInvite={false} />,
    );
    expect(
      screen.getByRole("checkbox", {
        name: "I agree to share my Big Three, planet signs, and our compatibility facts with the person who accepts.",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Create invite link" }),
    ).toBeTruthy();
  });

  it("shows an optional note under the title", () => {
    render(
      <InvitePanel
        title="Create a new link"
        note="Replaces the old one."
        hasPendingInvite
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Create a new link" }),
    ).toBeTruthy();
    expect(screen.getByText("Replaces the old one.")).toBeTruthy();
  });
});

describe("InvitePanel after creating a link", () => {
  it("shows the link, the exact single-use copy, and moves focus to the link", async () => {
    actions.createInviteLink.mockResolvedValueOnce({
      message: "https://astrapair.test/invite/abc",
      values: { expiresAt: "2026-10-06T10:00:00Z" },
    } as never);
    render(<InvitePanel title="Invite your partner" hasPendingInvite />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create invite link" }));

    const box = await screen.findByRole("textbox", { name: "Invite link" });
    expect((box as HTMLInputElement).value).toBe(
      "https://astrapair.test/invite/abc",
    );
    expect(
      screen.getByText("This link works once. Expires Oct 6, 2026."),
    ).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(box));
    // Read out with the link so screen reader users hear that it is ready.
    expect(box.getAttribute("aria-describedby")).toBeTruthy();
    expect(
      document.getElementById(box.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toBe("Your invite link is ready.");
  });
});

describe("InviteSection", () => {
  const LINK = "https://astrapair.test/invite/abc";

  async function createLink(view: ReturnType<typeof render>) {
    actions.createInviteLink.mockResolvedValueOnce({
      message: LINK,
      values: { expiresAt: "2026-10-06T10:00:00Z" },
    } as never);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create invite link" }));
    // The action result and the refreshed page arrive together in the app.
    await waitFor(() => expect(actions.createInviteLink).toHaveBeenCalled());
    view.rerender(
      <InviteSection pendingInvite={{ expiresAt: "2026-10-06T10:00:00Z" }} />,
    );
    return (await screen.findByRole("textbox", {
      name: "Invite link",
    })) as HTMLInputElement;
  }

  it("keeps the created link on screen when the page refreshes with a pending invite", async () => {
    const view = render(<InviteSection pendingInvite={null} />);
    const box = await createLink(view);
    expect(box.value).toBe(LINK);
    // The pending card appears above; the panel was not remounted.
    expect(screen.getByRole("heading", { name: "Your invite is waiting" }));
    expect(
      screen.getAllByRole("textbox", { name: "Invite link" }),
    ).toHaveLength(1);
    view.rerender(
      <InviteSection pendingInvite={{ expiresAt: "2026-10-07T10:00:00Z" }} />,
    );
    expect(
      (screen.getByRole("textbox", { name: "Invite link" }) as HTMLInputElement)
        .value,
    ).toBe(LINK);
  });

  it("hides the link and offers the form again once the invite is cancelled", async () => {
    const view = render(<InviteSection pendingInvite={null} />);
    await createLink(view);
    view.rerender(<InviteSection pendingInvite={null} />);
    expect(screen.queryByRole("textbox", { name: "Invite link" })).toBeNull();
    expect(screen.queryByText(/Your invite link is ready/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Create invite link" }),
    ).toBeTruthy();
  });
});

describe("CopyLink", () => {
  it("shows Copied after a successful copy", async () => {
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);
    render(<CopyLink link="https://astrapair.test/invite/abc" />);
    const box = screen.getByRole("textbox", { name: "Invite link" });
    expect((box as HTMLInputElement).value).toBe(
      "https://astrapair.test/invite/abc",
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByText("Copied")).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith("https://astrapair.test/invite/abc");
  });

  it("goes back to Copy after two seconds", async () => {
    vi.useFakeTimers();
    stubClipboard(async () => {});
    render(<CopyLink link="https://astrapair.test/invite/abc" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
    expect(screen.getByText("Copied")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(screen.queryByText("Copied")).toBeNull();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  });

  it("points to the box when the copy is rejected", async () => {
    stubClipboard(async () => {
      throw new Error("denied");
    });
    render(<CopyLink link="https://astrapair.test/invite/abc" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(
      await screen.findByText("Copy it manually from the box above."),
    ).toBeTruthy();
    expect(screen.queryByText("Copied")).toBeNull();
  });

  it("points to the box when the clipboard API is missing", async () => {
    render(<CopyLink link="https://astrapair.test/invite/abc" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() =>
      expect(
        screen.getByText("Copy it manually from the box above."),
      ).toBeTruthy(),
    );
  });
});

describe("PendingInvite", () => {
  it("shows the expiry, the single-use note and a cancel button", () => {
    render(<PendingInvite expiresAt="2026-10-06T10:00:00Z" />);
    expect(screen.getByText("This link works once.")).toBeTruthy();
    expect(screen.getByText(/Expires Oct 6, 2026/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel invite" })).toBeTruthy();
    // The invite panel is a sibling now, so it can keep its state across refreshes.
    expect(
      screen.queryByRole("heading", { name: "Create a new link" }),
    ).toBeNull();
  });
});

describe("DisconnectPanel", () => {
  it("reveals a confirmation that explains the deletion", () => {
    render(<DisconnectPanel relationshipId="rel-1" />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    const dialog = screen.getByRole("alertdialog");
    expect(
      within(dialog).getByText(
        "Your shared compatibility facts will be deleted for both of you straight away. You can connect again later with a new invite.",
      ),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: "Yes, disconnect" }),
    ).toBeTruthy();
    const hidden = dialog.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="relationshipId"]',
    );
    expect(hidden?.value).toBe("rel-1");
  });

  it("closes again when the person keeps the connection", () => {
    render(<DisconnectPanel relationshipId="rel-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep connection" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("ConnectedView", () => {
  it("shows both Big Three columns and the connection date", () => {
    render(
      <ConnectedView reportState={{ kind: "none" }} state={connected()} />,
    );
    expect(screen.getByText(/Connected with Alex/)).toBeTruthy();
    expect(screen.getByText(/Sep 20, 2026/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "You" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Alex" })).toBeTruthy();
  });

  it("falls back to a generic name when the partner has none", () => {
    const state = connected();
    render(
      <ConnectedView
        reportState={{ kind: "none" }}
        state={{ ...state, partner: { ...state.partner, displayName: null } }}
      />,
    );
    expect(screen.getByText(/Connected with your partner/)).toBeTruthy();
  });

  it("groups aspects, collapses the long tail and lists overlays", () => {
    render(
      <ConnectedView reportState={{ kind: "none" }} state={connected()} />,
    );
    expect(screen.getByRole("heading", { name: "Supportive" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Challenging" })).toBeTruthy();
    expect(screen.getAllByText(/^Show all \(\d+\)$/).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("heading", { name: "Their planets in your houses" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Your planets in their houses" }),
    ).toBeTruthy();
    expect(
      screen.getAllByText(/^Their .+ falls in your /).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/^Your .+ falls in their /).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/is left out because/)).toBeNull();
  });

  it("notes that the partner's Moon is left out when their time is unknown", () => {
    const state = connected({
      partner: summarizeChart(unknownPartner, "Alex"),
      synastry: calculateSynastry(you, unknownPartner),
    });
    render(<ConnectedView reportState={{ kind: "none" }} state={state} />);
    expect(
      screen.getByText(
        "Alex's Moon is left out because their birth time is unknown.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Needs a birth time")).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Your planets in their houses" }),
    ).toBeNull();
  });

  it("notes that the viewer's Moon is left out when their time is unknown", () => {
    const unknownYou = provider.calculateNatalChart({
      ...exact,
      birthTime: null,
      accuracy: "unknown",
    });
    const state = connected({
      you: summarizeChart(unknownYou, "Sam"),
      synastry: calculateSynastry(unknownYou, knownPartner),
    });
    render(<ConnectedView reportState={{ kind: "none" }} state={state} />);
    expect(
      screen.getByText(
        "Your Moon is left out because your birth time is unknown.",
      ),
    ).toBeTruthy();
  });

  it("names who is still to add birth details", () => {
    const state = connected();
    render(
      <ConnectedView
        reportState={{ kind: "none" }}
        state={{
          ...state,
          partner: summarizeChart(null, "Alex"),
          synastry: null,
        }}
      />,
    );
    expect(
      screen.getByText(/Waiting for Alex to add their birth details/),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Supportive" })).toBeNull();
  });

  it("links the viewer to birth details when their chart is missing", () => {
    const state = connected();
    render(
      <ConnectedView
        reportState={{ kind: "none" }}
        state={{ ...state, you: summarizeChart(null, "Sam"), synastry: null }}
      />,
    );
    const link = screen.getByRole("link", { name: "Add your birth details" });
    expect(link.getAttribute("href")).toBe("/chart/birth-details");
  });

  it("shows the error, not the waiting copy, when synastry failed", () => {
    const state = connected();
    render(
      <ConnectedView
        reportState={{ kind: "none" }}
        state={{
          ...state,
          you: summarizeChart(null, "Sam"),
          synastry: null,
          synastryError: true,
        }}
      />,
    );
    expect(
      screen.getByText(
        "We couldn't calculate your compatibility facts. Try again.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Waiting for/)).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Add your birth details" }),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "Reload" }).getAttribute("href"),
    ).toBe("/partner");
  });

  it("shows the report card after the synastry sections and before disconnect", () => {
    render(
      <ConnectedView reportState={{ kind: "none" }} state={connected()} />,
    );
    const card = screen.getByRole("heading", { name: "Compatibility report" });
    const last = screen.getByRole("heading", {
      name: "Your planets in their houses",
    });
    const disconnect = screen.getByRole("heading", {
      name: "End the connection",
    });
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(last, card)).toBe(true);
    expect(follows(card, disconnect)).toBe(true);
  });

  it("shows no report card while a chart is missing", () => {
    const state = connected();
    render(
      <ConnectedView
        reportState={{ kind: "waiting_for_charts" }}
        state={{
          ...state,
          partner: summarizeChart(null, "Alex"),
          synastry: null,
        }}
      />,
    );
    expect(
      screen.queryByRole("heading", { name: "Compatibility report" }),
    ).toBeNull();
  });

  it("ends with the disconnect control", () => {
    render(
      <ConnectedView reportState={{ kind: "none" }} state={connected()} />,
    );
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
  });
});
