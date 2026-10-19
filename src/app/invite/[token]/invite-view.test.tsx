import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./actions", () => ({
  acceptInvite: vi.fn(async () => ({})),
  declineInvite: vi.fn(async () => ({})),
}));

import {
  resolveInviteView,
  type InviteView,
  type Preview,
  type Viewer,
} from "./invite-state";
import { InviteViewContent } from "./invite-view";

const TOKEN = "T".repeat(43);
const NEXT = encodeURIComponent(`/invite/${TOKEN}`);

const validPreview: Preview = {
  kind: "valid",
  inviterName: "Alex",
  isOwn: false,
};

async function resolve(
  preview: Preview,
  signedIn: boolean,
  viewer: Viewer = { onboarded: true, connection: "none" },
) {
  const loadViewer = vi.fn(async () => viewer);
  const view = await resolveInviteView({
    preview,
    token: TOKEN,
    signedIn,
    loadViewer,
  });
  return { view, loadViewer };
}

function show(view: InviteView) {
  if (view.kind === "redirect") throw new Error("expected something to render");
  return render(<InviteViewContent view={view} token={TOKEN} />);
}

afterEach(cleanup);

describe("invite page states", () => {
  it.each([
    [
      "not_found",
      "This invite isn't valid",
      "This invite link isn't valid. Ask your partner for a new one.",
    ],
    [
      "expired",
      "This invite has expired",
      "This invite link has expired. Ask your partner for a new one.",
    ],
    [
      "used",
      "This invite was already used",
      "This invite link has already been used.",
    ],
    [
      "revoked",
      "This invite was cancelled",
      "This invite link was cancelled. Ask your partner for a new one.",
    ],
  ] as const)(
    "shows the %s notice and never loads the viewer",
    async (kind, title, body) => {
      const { view, loadViewer } = await resolve({ kind }, true);
      expect(loadViewer).not.toHaveBeenCalled();
      show(view);
      expect(screen.getByRole("heading", { name: title })).toBeTruthy();
      expect(screen.getByText(body)).toBeTruthy();
      expect(
        screen
          .getByRole("link", { name: "Back to dashboard" })
          .getAttribute("href"),
      ).toBe("/dashboard");
    },
  );

  it("sends a signed-out visitor of a dead invite back home", async () => {
    const { view } = await resolve({ kind: "expired" }, false);
    show(view);
    expect(
      screen.getByRole("link", { name: "Back to home" }).getAttribute("href"),
    ).toBe("/");
  });

  it("shows the rate limit notice", async () => {
    const { view, loadViewer } = await resolve({ kind: "limited" }, false);
    expect(loadViewer).not.toHaveBeenCalled();
    show(view);
    expect(
      screen.getByRole("heading", { name: "Please slow down" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Too many attempts. Please wait a little and try again.",
      ),
    ).toBeTruthy();
  });

  it("shows a generic notice when the preview failed", async () => {
    const { view } = await resolve({ kind: "failed" }, true);
    show(view);
    expect(
      screen.getByRole("heading", { name: "We couldn't load this invite" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Something went wrong. Please try again."),
    ).toBeTruthy();
  });

  it("invites a signed-out visitor to sign up or sign in, keeping the invite", async () => {
    const { view, loadViewer } = await resolve(validPreview, false);
    expect(loadViewer).not.toHaveBeenCalled();
    show(view);
    expect(
      screen.getByRole("heading", {
        name: "Alex invited you to connect on AstraPair",
      }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Create an account" })
        .getAttribute("href"),
    ).toBe(`/signup?next=${NEXT}`);
    expect(
      screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
    ).toBe(`/login?next=${NEXT}`);
  });

  it("sends a signed-in person who has not onboarded to onboarding with next", async () => {
    const { view } = await resolve(validPreview, true, {
      onboarded: false,
      connection: "none",
    });
    expect(view).toEqual({
      kind: "redirect",
      to: `/onboarding?next=${NEXT}`,
    });
  });

  it("tells the inviter this is their own invite", async () => {
    const { view } = await resolve({ ...validPreview, isOwn: true }, true);
    show(view);
    expect(
      screen.getByRole("heading", { name: "This is your invite" }),
    ).toBeTruthy();
    expect(screen.getByText(/your own invite link/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Go to partner" }).getAttribute("href"),
    ).toBe("/partner");
  });

  it("shows the own-invite notice even when the connection check failed", async () => {
    const { view } = await resolve({ ...validPreview, isOwn: true }, true, {
      onboarded: true,
      connection: "error",
    });
    show(view);
    expect(
      screen.getByRole("heading", { name: "This is your invite" }),
    ).toBeTruthy();
  });

  it("tells someone already connected, without offering Accept", async () => {
    const { view } = await resolve(validPreview, true, {
      onboarded: true,
      connection: "connected",
    });
    show(view);
    expect(
      screen.getByRole("heading", { name: "You're already connected" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Go to partner" }).getAttribute("href"),
    ).toBe("/partner");
  });

  it("shows a generic notice when the connection check failed", async () => {
    const { view } = await resolve(validPreview, true, {
      onboarded: true,
      connection: "error",
    });
    show(view);
    expect(
      screen.getByRole("heading", { name: "We couldn't load this invite" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });

  it("offers Accept and Decline to a signed-in, onboarded, unconnected person", async () => {
    const { view, loadViewer } = await resolve(validPreview, true);
    expect(loadViewer).toHaveBeenCalledTimes(1);
    show(view);
    expect(
      screen.getByRole("heading", { name: "Alex invited you to connect" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decline" })).toBeTruthy();
  });
});
