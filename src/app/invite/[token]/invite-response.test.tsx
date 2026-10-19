import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  acceptInvite: vi.fn(async () => ({})),
  declineInvite: vi.fn(async () => ({})),
}));
vi.mock("./actions", () => actions);

import { InviteResponse } from "./invite-response";

const TOKEN = "T".repeat(43);

function renderResponse() {
  return render(<InviteResponse token={TOKEN} inviterName="Alex" />);
}

describe("InviteResponse", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("lists what the inviter sees and what is never shared", () => {
    renderResponse();
    expect(
      screen.getByRole("heading", { name: "What Alex will see" }),
    ).toBeTruthy();
    expect(screen.getByText("Your display name")).toBeTruthy();
    expect(screen.getByText(/Sun, Moon and rising signs/)).toBeTruthy();
    expect(screen.getByText("The signs of your planets")).toBeTruthy();
    expect(screen.getByText(/Compatibility facts/)).toBeTruthy();

    expect(screen.getByRole("heading", { name: "Never shared" })).toBeTruthy();
    expect(
      screen.getByText(/birth date, birth time and birthplace/),
    ).toBeTruthy();
    expect(screen.getByText("Your account details")).toBeTruthy();
    expect(screen.getByText("Your private AI chats")).toBeTruthy();
  });

  it("offers a consent checkbox plus Accept and Decline buttons", () => {
    renderResponse();
    expect(
      screen.getByRole("checkbox", { name: "I agree to share this with Alex" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decline" })).toBeTruthy();
  });

  it("puts the token only in a hidden field of both forms", () => {
    const { container } = renderResponse();
    const fields = container.querySelectorAll<HTMLInputElement>(
      'input[type="hidden"][name="token"]',
    );
    expect(fields).toHaveLength(2);
    fields.forEach((field) => expect(field.value).toBe(TOKEN));
    expect(container.textContent).not.toContain(TOKEN);
  });

  it("shows the consent error from the accept action", async () => {
    actions.acceptInvite.mockResolvedValueOnce({
      fieldErrors: { shareConsent: ["Tick the box to confirm."] },
    } as never);
    renderResponse();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByText("Tick the box to confirm.")).toBeTruthy();
  });

  it("shows the decline message and a dashboard link", async () => {
    actions.declineInvite.mockResolvedValueOnce({
      message: "Invite declined.",
    } as never);
    renderResponse();
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(await screen.findByText("Invite declined.")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Go to your dashboard" });
    expect(link.getAttribute("href")).toBe("/dashboard");
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });
});
