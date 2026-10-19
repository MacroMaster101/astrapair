import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ signInWithGoogle: vi.fn() }));
vi.mock("@/app/(auth)/actions", () => actions);

import { GoogleButton, OrDivider } from "./google-button";

beforeEach(() => {
  actions.signInWithGoogle.mockReset();
  actions.signInWithGoogle.mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe("GoogleButton", () => {
  it("is a submit button named Continue with Google", () => {
    render(<GoogleButton />);
    const button = screen.getByRole("button", { name: "Continue with Google" });
    expect(button.getAttribute("type")).toBe("submit");
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("draws the Google G as a decorative multi-colour SVG", () => {
    render(<GoogleButton />);
    const svg = screen
      .getByRole("button", { name: "Continue with Google" })
      .querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("focusable")).toBe("false");
    const fills = Array.from(svg!.querySelectorAll("path")).map((path) =>
      path.getAttribute("fill"),
    );
    expect(new Set(fills)).toEqual(
      new Set(["#4285F4", "#34A853", "#FBBC05", "#EA4335"]),
    );
  });

  it("posts the next path in a hidden field", async () => {
    render(<GoogleButton next="/onboarding?next=%2Fchart" />);
    const hidden = document.querySelector(
      "input[type=hidden][name=next]",
    ) as HTMLInputElement;
    expect(hidden.value).toBe("/onboarding?next=%2Fchart");

    fireEvent.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );
    await waitFor(() =>
      expect(actions.signInWithGoogle).toHaveBeenCalledTimes(1),
    );
    const posted = actions.signInWithGoogle.mock.calls[0][0] as FormData;
    expect(posted.get("next")).toBe("/onboarding?next=%2Fchart");
  });

  it("posts no next field when there is none", async () => {
    render(<GoogleButton />);
    expect(document.querySelector("input[name=next]")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );
    await waitFor(() =>
      expect(actions.signInWithGoogle).toHaveBeenCalledTimes(1),
    );
    expect(
      (actions.signInWithGoogle.mock.calls[0][0] as FormData).has("next"),
    ).toBe(false);
  });

  it("locks the button and says what is happening while it works", async () => {
    let finish: () => void = () => {};
    actions.signInWithGoogle.mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    render(<GoogleButton />);
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );
    const busy = await screen.findByRole("button", {
      name: "Opening Google…",
    });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    finish();
    await screen.findByRole("button", { name: "Continue with Google" });
  });

  it("uses no em or en dashes in its copy", () => {
    render(<GoogleButton />);
    expect(document.body.textContent).not.toMatch(/[–—]/);
  });
});

describe("OrDivider", () => {
  it("shows or, hidden from assistive technology", () => {
    render(<OrDivider />);
    const divider = screen.getByText("or").parentElement as HTMLElement;
    expect(divider.getAttribute("aria-hidden")).toBe("true");
  });
});
