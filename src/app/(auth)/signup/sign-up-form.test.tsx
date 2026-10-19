import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormState } from "@/lib/auth/validation";

const actions = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithGoogle: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../actions", () => actions);

import SignUpPage from "./page";
import { SignUpForm } from "./sign-up-form";

beforeEach(() => {
  actions.signUp.mockReset();
  actions.signUp.mockResolvedValue({} as FormState);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("SignUpForm invite code", () => {
  it("has no invite code field by default", () => {
    render(<SignUpForm />);
    expect(screen.queryByLabelText("Invite code")).toBeNull();
  });

  it("has no invite code field when the gate is off", () => {
    render(<SignUpForm betaGate={false} />);
    expect(screen.queryByLabelText("Invite code")).toBeNull();
  });

  it("shows a required, private invite code field when the gate is on", () => {
    render(<SignUpForm betaGate />);
    const field = screen.getByLabelText("Invite code");
    expect(field).toHaveProperty("name", "betaCode");
    expect(field).toHaveProperty("required", true);
    expect(field.getAttribute("autocomplete")).toBe("off");
    expect(field.getAttribute("spellcheck")).toBe("false");
    expect(field.getAttribute("maxlength")).toBe("64");
  });

  it("submits the typed code with the other fields", async () => {
    render(<SignUpForm betaGate />);
    fireEvent.change(screen.getByLabelText("Invite code"), {
      target: { value: "ABCD2345WXYZ" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await screen.findByRole("button", { name: "Create account" });
    const submitted = actions.signUp.mock.calls[0][1] as FormData;
    expect(submitted.get("betaCode")).toBe("ABCD2345WXYZ");
  });

  it("shows the field error under the field and keeps what was typed", async () => {
    actions.signUp.mockResolvedValue({
      fieldErrors: {
        betaCode: ["That invite code isn't valid or has been used up."],
      },
      values: {
        displayName: "Sam",
        email: "sam@example.com",
        betaCode: "WRONGCODE123",
      },
    } satisfies FormState);
    render(<SignUpForm betaGate />);
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(
      await screen.findByText(
        "That invite code isn't valid or has been used up.",
      ),
    ).toBeTruthy();
    const field = screen.getByLabelText("Invite code") as HTMLInputElement;
    expect(field.value).toBe("WRONGCODE123");
    expect(field.getAttribute("aria-invalid")).toBe("true");
  });
});

describe("SignUpPage", () => {
  const renderPage = async () =>
    render(await SignUpPage({ searchParams: Promise.resolve({}) } as never));

  it("asks for a code only when BETA_GATE is on", async () => {
    vi.stubEnv("BETA_GATE", " On ");
    await renderPage();
    expect(screen.getByLabelText("Invite code")).toBeTruthy();
  });

  it("does not ask for a code when BETA_GATE is unset, off or something else", async () => {
    for (const value of [undefined, "", "off", "true"]) {
      cleanup();
      if (value === undefined) vi.stubEnv("BETA_GATE", undefined);
      else vi.stubEnv("BETA_GATE", value);
      await renderPage();
      expect(screen.queryByLabelText("Invite code"), String(value)).toBeNull();
    }
  });
});

describe("SignUpPage Google sign-in", () => {
  const renderPage = async (params: Record<string, string> = {}) =>
    render(
      await SignUpPage({ searchParams: Promise.resolve(params) } as never),
    );
  const button = () =>
    screen.queryByRole("button", { name: "Continue with Google" });
  const LINE =
    "Have an invite code? Create your account with email first. You can use Google to sign in afterwards with the same email address.";

  it("shows the button above the form, with no invite line, when sign-ups are open", async () => {
    vi.stubEnv("BETA_GATE", "off");
    await renderPage();
    const google = button();
    expect(google).toBeTruthy();
    const create = screen.getByRole("button", { name: "Create account" });
    expect(
      google!.compareDocumentPosition(create) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("or")).toBeTruthy();
    expect(screen.queryByText(LINE)).toBeNull();
  });

  it("hides the button and explains the order of things while the beta gate is on", async () => {
    vi.stubEnv("BETA_GATE", "on");
    await renderPage();
    expect(button()).toBeNull();
    expect(screen.queryByText("or")).toBeNull();
    const line = screen.getByText(LINE);
    const create = screen.getByRole("button", { name: "Create account" });
    expect(
      create.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(LINE).not.toMatch(/[–—]/);
  });

  it("hides the button and the invite line everywhere when GOOGLE_AUTH is off", async () => {
    vi.stubEnv("GOOGLE_AUTH", "off");
    for (const gate of ["on", "off"]) {
      cleanup();
      vi.stubEnv("BETA_GATE", gate);
      await renderPage();
      expect(button(), gate).toBeNull();
      expect(screen.queryByText("or"), gate).toBeNull();
      expect(screen.queryByText(LINE), gate).toBeNull();
    }
  });

  it("sends a new Google user through onboarding, carrying a safe next path", async () => {
    vi.stubEnv("BETA_GATE", "off");
    await renderPage({ next: "/invite/abc" });
    const hidden = button()!
      .closest("form")!
      .querySelector("input[name=next]") as HTMLInputElement;
    expect(hidden.value).toBe("/onboarding?next=%2Finvite%2Fabc");

    cleanup();
    await renderPage({ next: "//evil.example" });
    const plain = button()!
      .closest("form")!
      .querySelector("input[name=next]") as HTMLInputElement;
    expect(plain.value).toBe("/onboarding");
  });
});
