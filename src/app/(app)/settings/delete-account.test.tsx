import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormState } from "@/lib/auth/validation";

const actions = vi.hoisted(() => ({
  deleteAccountAction: vi.fn(),
  updateProfile: vi.fn(),
  signInAgainAction: vi.fn(),
}));
const deletion = vi.hoisted(() => ({ accountRequiresPassword: vi.fn() }));
vi.mock("./actions", () => actions);
vi.mock("@/lib/account/deletion", () => deletion);
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({
  getProfile: async () => ({ id: "u", display_name: "Sam", onboarded_at: "x" }),
}));

import { DeleteAccountPanel } from "./delete-account-panel";
import SettingsPage from "./page";

const PASSWORD = "correct horse battery staple";

beforeEach(() => {
  actions.deleteAccountAction.mockReset();
  actions.deleteAccountAction.mockResolvedValue({} as FormState);
  actions.signInAgainAction.mockReset();
  deletion.accountRequiresPassword.mockReset();
  deletion.accountRequiresPassword.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
});

function open() {
  render(<DeleteAccountPanel />);
  const trigger = screen.getByRole("button", { name: "Delete account" });
  fireEvent.click(trigger);
  return { trigger, dialog: screen.getByRole("alertdialog") };
}

function fill(dialog: HTMLElement, confirmation: string, password: string) {
  fireEvent.change(within(dialog).getByLabelText("Type DELETE to confirm"), {
    target: { value: confirmation },
  });
  fireEvent.change(within(dialog).getByLabelText("Current password"), {
    target: { value: password },
  });
}

describe("DeleteAccountPanel", () => {
  it("shows only the trigger until it is clicked", () => {
    render(<DeleteAccountPanel />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const trigger = screen.getByRole("button", { name: "Delete account" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens a labelled, described alertdialog and moves focus into it", () => {
    const { trigger, dialog } = open();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    expect(
      screen.getByRole("alertdialog", {
        name: "Delete your account for good?",
      }),
    ).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(
      within(dialog).getByLabelText("Type DELETE to confirm"),
    );
  });

  it("has labelled inputs, a private password field and the destructive submit", () => {
    const { dialog } = open();
    const confirmation = within(dialog).getByLabelText(
      "Type DELETE to confirm",
    ) as HTMLInputElement;
    expect(confirmation.name).toBe("confirmation");
    expect(confirmation.autocomplete).toBe("off");

    const password = within(dialog).getByLabelText(
      "Current password",
    ) as HTMLInputElement;
    expect(password.type).toBe("password");
    expect(password.name).toBe("password");
    expect(password.autocomplete).toBe("current-password");
    expect(password.defaultValue).toBe("");

    expect(
      within(dialog).getByRole("button", { name: "Yes, delete my account" }),
    ).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("closes on Cancel and returns focus to the trigger", () => {
    const { trigger, dialog } = open();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on Escape and returns focus to the trigger", () => {
    const { trigger, dialog } = open();
    fireEvent.keyDown(within(dialog).getByLabelText("Current password"), {
      key: "Escape",
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("submits both fields to the action", async () => {
    const { dialog } = open();
    fill(dialog, "DELETE", PASSWORD);
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() =>
      expect(actions.deleteAccountAction).toHaveBeenCalledTimes(1),
    );
    const formData = actions.deleteAccountAction.mock.calls[0][1] as FormData;
    expect(formData.get("confirmation")).toBe("DELETE");
    expect(formData.get("password")).toBe(PASSWORD);
    expect(formData.has("email")).toBe(false);
  });

  it("shows the copy for a password check that could not be made", async () => {
    actions.deleteAccountAction.mockResolvedValue({
      error:
        "We couldn't check your password right now. Try again in a few minutes.",
      values: { confirmation: "DELETE" },
    } satisfies FormState);
    const { dialog } = open();
    fill(dialog, "DELETE", PASSWORD);
    fireEvent.submit(dialog.querySelector("form")!);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "We couldn't check your password right now. Try again in a few minutes.",
    );
    expect(screen.queryByRole("button", { name: "Sign in again" })).toBeNull();
  });

  it("shows the error, keeps the confirmation and never echoes the password", async () => {
    actions.deleteAccountAction.mockResolvedValue({
      error: "That password isn't correct.",
      values: { confirmation: "DELETE" },
    } satisfies FormState);
    const { dialog } = open();
    fill(dialog, "DELETE", PASSWORD);
    fireEvent.submit(dialog.querySelector("form")!);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("That password isn't correct.");
    await waitFor(() => {
      const confirmation = within(dialog).getByLabelText(
        "Type DELETE to confirm",
      ) as HTMLInputElement;
      const password = within(dialog).getByLabelText(
        "Current password",
      ) as HTMLInputElement;
      expect(confirmation.value).toBe("DELETE");
      expect(password.value).toBe("");
    });
    expect(dialog.innerHTML).not.toContain(PASSWORD);
  });

  it("shows a field error under the password", async () => {
    actions.deleteAccountAction.mockResolvedValue({
      fieldErrors: { password: ["Enter your password."] },
    } satisfies FormState);
    const { dialog } = open();
    fireEvent.submit(dialog.querySelector("form")!);
    expect(await screen.findByText("Enter your password.")).toBeTruthy();
  });

  it("marks the region busy and locks the buttons while deleting", async () => {
    let finish: (state: FormState) => void = () => {};
    actions.deleteAccountAction.mockImplementation(
      () => new Promise<FormState>((resolve) => (finish = resolve)),
    );
    const { dialog } = open();
    fill(dialog, "DELETE", PASSWORD);
    fireEvent.submit(dialog.querySelector("form")!);

    await waitFor(() => expect(dialog.getAttribute("aria-busy")).toBe("true"));
    const submit = within(dialog).getByRole("button", { name: "Deleting…" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    expect((cancel as HTMLButtonElement).disabled).toBe(true);

    // Escape does nothing while the request is running.
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeNull();

    await act(async () => finish({ error: "x" }));
    await waitFor(() => expect(dialog.getAttribute("aria-busy")).toBe("false"));
  });

  it("starts clean when reopened after an error", async () => {
    actions.deleteAccountAction.mockResolvedValue({
      error: "That password isn't correct.",
    } satisfies FormState);
    const { dialog } = open();
    fireEvent.submit(dialog.querySelector("form")!);
    await screen.findByRole("alert");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Settings page delete account card", () => {
  it("lists exactly what happens and drops the old placeholder", async () => {
    render(await SettingsPage());
    expect(screen.queryByText(/Account deletion will be available/)).toBeNull();
    const card = screen
      .getByText("Delete account", { selector: "[data-slot=card-title]" })
      .closest("[data-slot=card]") as HTMLElement;
    expect(card).toBeTruthy();
    const text = card.textContent ?? "";
    expect(text).toContain(
      "Your profile, birth details, charts, conversations and usage records are deleted at once.",
    );
    expect(text).toContain("If you are connected, the connection ends.");
    expect(text).toContain(
      "Your shared compatibility data and report are deleted for both of you.",
    );
    expect(text).toContain("Your partner keeps their own data.");
    expect(text).toContain(
      "Some security logs without your name are kept for up to 12 months, and older entries are removed during regular maintenance.",
    );
    expect(text).toContain(
      "Anonymous product events are kept without your name or email.",
    );
    expect(text).toContain("This cannot be undone.");
    expect(
      within(card).getByRole("button", { name: "Delete account" }),
    ).toBeTruthy();
    expect(text).not.toMatch(/[–—]/);
  });

  it("puts the delete card after the privacy card", async () => {
    render(await SettingsPage());
    const titles = Array.from(
      document.querySelectorAll("[data-slot=card-title]"),
    ).map((el) => el.textContent);
    expect(titles).toEqual([
      "Profile",
      "Password",
      "Privacy",
      "Delete account",
    ]);
  });
});

describe("DeleteAccountPanel for an account without a password", () => {
  function openWithoutPassword() {
    render(<DeleteAccountPanel requiresPassword={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    return screen.getByRole("alertdialog");
  }

  it("asks for DELETE only and does not render a password field", () => {
    const dialog = openWithoutPassword();
    expect(
      within(dialog).getByLabelText("Type DELETE to confirm"),
    ).toBeTruthy();
    expect(within(dialog).queryByLabelText("Current password")).toBeNull();
    expect(dialog.querySelector("input[type=password]")).toBeNull();
    expect(dialog.querySelector("input[name=password]")).toBeNull();
  });

  it("explains that a recent sign-in is needed instead of a password", () => {
    const dialog = openWithoutPassword();
    const text = dialog.textContent ?? "";
    expect(text).toContain("type DELETE");
    expect(text).toContain("signed in within the last 10 minutes");
    expect(text).not.toContain("current password");
    expect(text).not.toMatch(/[–—]/);
  });

  it("submits the confirmation with the recent sign-in method and no password", async () => {
    const dialog = openWithoutPassword();
    fireEvent.change(within(dialog).getByLabelText("Type DELETE to confirm"), {
      target: { value: "DELETE" },
    });
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() =>
      expect(actions.deleteAccountAction).toHaveBeenCalledTimes(1),
    );
    const formData = actions.deleteAccountAction.mock.calls[0][1] as FormData;
    expect(formData.get("confirmation")).toBe("DELETE");
    expect(formData.get("method")).toBe("recent_sign_in");
    expect(formData.has("password")).toBe(false);
  });

  it("offers Sign in again only after the service asks for a fresh sign-in", async () => {
    const dialog = openWithoutPassword();
    expect(
      within(dialog).queryByRole("button", { name: "Sign in again" }),
    ).toBeNull();

    actions.deleteAccountAction.mockResolvedValue({
      error:
        "For your security, sign in again and then delete your account within 10 minutes.",
      code: "reauth_required",
      values: { confirmation: "DELETE" },
    } satisfies FormState);
    fireEvent.submit(dialog.querySelector("form")!);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "For your security, sign in again and then delete your account within 10 minutes.",
    );
    const again = await within(dialog).findByRole("button", {
      name: "Sign in again",
    });
    expect(again.getAttribute("type")).toBe("submit");
  });

  it("signs out and sends the person to sign in when Sign in again is used", async () => {
    actions.deleteAccountAction.mockResolvedValue({
      error: "x",
      code: "reauth_required",
    } satisfies FormState);
    const dialog = openWithoutPassword();
    fireEvent.submit(dialog.querySelector("form")!);
    const again = await within(dialog).findByRole("button", {
      name: "Sign in again",
    });
    fireEvent.click(again);
    await waitFor(() =>
      expect(actions.signInAgainAction).toHaveBeenCalledTimes(1),
    );
  });

  it("does not offer Sign in again for other errors", async () => {
    actions.deleteAccountAction.mockResolvedValue({
      error:
        "We couldn't delete your account. Nothing was changed. Please try again.",
    } satisfies FormState);
    const dialog = openWithoutPassword();
    fireEvent.submit(dialog.querySelector("form")!);
    await screen.findByRole("alert");
    expect(
      within(dialog).queryByRole("button", { name: "Sign in again" }),
    ).toBeNull();
  });
});

describe("DeleteAccountPanel for an account with a password", () => {
  it("is the same as before by default: password field, no method, no sign in again", async () => {
    const { dialog } = open();
    expect(within(dialog).getByLabelText("Current password")).toBeTruthy();
    expect(dialog.textContent).toContain("enter your current password");
    expect(dialog.querySelector("input[name=method]")).toBeNull();
    expect(
      within(dialog).queryByRole("button", { name: "Sign in again" }),
    ).toBeNull();
  });

  it("renders the password field when requiresPassword is true", () => {
    render(<DeleteAccountPanel requiresPassword />);
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    expect(screen.getByLabelText("Current password")).toBeTruthy();
  });
});

describe("Settings page delete account mode", () => {
  async function openDeleteDialog() {
    render(await SettingsPage());
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    return screen.getByRole("alertdialog");
  }

  it("asks for the password when the account has one", async () => {
    deletion.accountRequiresPassword.mockResolvedValue(true);
    const dialog = await openDeleteDialog();
    expect(within(dialog).getByLabelText("Current password")).toBeTruthy();
  });

  it("drops the password field for a Google only account", async () => {
    deletion.accountRequiresPassword.mockResolvedValue(false);
    const dialog = await openDeleteDialog();
    expect(within(dialog).queryByLabelText("Current password")).toBeNull();
    expect(dialog.textContent).toContain(
      "signed in within the last 10 minutes",
    );
  });
});
