import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../actions", () => ({
  signIn: vi.fn(),
  signInWithGoogle: vi.fn(),
}));

import LoginPage from "./page";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const renderPage = async (params: Record<string, string | string[]> = {}) =>
  render(await LoginPage({ searchParams: Promise.resolve(params) } as never));

const googleButton = () =>
  screen.queryByRole("button", { name: "Continue with Google" });

describe("LoginPage Google sign-in", () => {
  it("shows the Google button above the email form by default", async () => {
    vi.stubEnv("GOOGLE_AUTH", undefined);
    await renderPage();
    const button = googleButton();
    expect(button).toBeTruthy();
    const signIn = screen.getByRole("button", { name: "Sign in" });
    expect(
      button!.compareDocumentPosition(signIn) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("or")).toBeTruthy();
  });

  it("still shows the button while the closed beta is on", async () => {
    vi.stubEnv("BETA_GATE", "on");
    await renderPage();
    expect(googleButton()).toBeTruthy();
  });

  it("hides the button and the divider when GOOGLE_AUTH is off", async () => {
    vi.stubEnv("GOOGLE_AUTH", " OFF ");
    await renderPage();
    expect(googleButton()).toBeNull();
    expect(screen.queryByText("or")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("carries a safe next path to Google and drops an unsafe one", async () => {
    await renderPage({ next: "/chart" });
    const hidden = within(
      googleButton()!.closest("form") as HTMLFormElement,
    ).queryByDisplayValue("/chart");
    expect(hidden).toBeTruthy();

    cleanup();
    await renderPage({ next: "//evil.example" });
    const form = googleButton()!.closest("form") as HTMLFormElement;
    expect(form.querySelector("input[name=next]")).toBeNull();
  });
});

describe("LoginPage ?error=", () => {
  it.each([
    [
      "oauth_no_account",
      "There's no AstraPair account for that Google email yet. Create an account with your invite code first, then you can sign in with Google.",
    ],
    [
      "oauth_unavailable",
      "Google sign-in isn't available right now. Please try again, or use your email and password.",
    ],
    [
      "oauth_failed",
      "We couldn't sign you in. Please try again, or use your email and password.",
    ],
    [
      "oauth_rate_limited",
      "Too many attempts. Please wait a few minutes and try again.",
    ],
  ])("shows the copy for %s in an alert", async (code, copy) => {
    await renderPage({ error: code });
    expect(screen.getByRole("alert").textContent).toBe(copy);
  });

  it("keeps the link_invalid message", async () => {
    await renderPage({ error: "link_invalid" });
    expect(screen.getByRole("alert").textContent).toContain(
      "That link is invalid or has expired.",
    );
  });

  it.each([
    "<b>hello</b>",
    "access_denied",
    "constructor",
    "__proto__",
    "toString",
    "",
  ])("shows nothing for the unknown value %j", async (value) => {
    await renderPage({ error: value });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.body.innerHTML).not.toContain("<b>hello</b>");
  });

  it("shows nothing for a repeated error parameter", async () => {
    await renderPage({ error: ["oauth_failed", "oauth_no_account"] });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("never echoes the raw error_description", async () => {
    await renderPage({
      error: "oauth_failed",
      error_description: "secret provider text",
    });
    expect(document.body.textContent).not.toContain("secret provider text");
  });
});
