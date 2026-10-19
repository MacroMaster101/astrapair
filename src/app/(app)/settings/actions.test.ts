import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

class RedirectError extends Error {
  constructor(readonly url: string) {
    super(`redirect:${url}`);
  }
}

const fake = vi.hoisted(() => ({
  deleteOwnAccount: vi.fn(),
  signOut: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUserId: async () => "user-1" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: fake.createClient }));
vi.mock("@/lib/account/deletion", () => ({
  deleteOwnAccount: fake.deleteOwnAccount,
}));

import { deleteAccountAction, signInAgainAction } from "./actions";

const PASSWORD = "correct horse battery staple";

function form(fields: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("confirmation", "DELETE");
  fd.set("password", PASSWORD);
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  fake.deleteOwnAccount.mockReset();
  fake.deleteOwnAccount.mockResolvedValue({ ok: true });
  fake.signOut.mockReset();
  fake.signOut.mockResolvedValue({ error: null });
  fake.createClient.mockReset();
  fake.createClient.mockResolvedValue({ auth: { signOut: fake.signOut } });
});

describe("deleteAccountAction", () => {
  it("passes both fields to the service and redirects with a goodbye flag", async () => {
    await expect(deleteAccountAction({}, form())).rejects.toMatchObject({
      url: "/?account=deleted",
    });
    expect(fake.deleteOwnAccount).toHaveBeenCalledTimes(1);
    expect(fake.deleteOwnAccount).toHaveBeenCalledWith({
      confirmation: "DELETE",
      password: PASSWORD,
    });
  });

  it("ignores an email field in the form", async () => {
    await expect(
      deleteAccountAction({}, form({ email: "victim@example.com" })),
    ).rejects.toBeInstanceOf(RedirectError);
    expect(fake.deleteOwnAccount.mock.calls[0][0]).not.toHaveProperty("email");
  });

  it.each([
    ["confirmation", "Type DELETE exactly to confirm."],
    ["password", "Enter your password."],
  ])(
    "asks for a missing %s without calling the service",
    async (name, copy) => {
      const fd = form();
      fd.delete(name);
      const state = await deleteAccountAction({}, fd);
      expect(JSON.stringify(state)).toContain(copy);
      expect(fake.deleteOwnAccount).not.toHaveBeenCalled();
    },
  );

  it("rejects an empty password without calling the service", async () => {
    const state = await deleteAccountAction({}, form({ password: "" }));
    expect(state.fieldErrors?.password).toEqual(["Enter your password."]);
    expect(fake.deleteOwnAccount).not.toHaveBeenCalled();
  });

  it.each([
    ["bad_confirmation", "Type DELETE exactly to confirm."],
    ["bad_password", "That password isn't correct."],
    ["rate_limited", "Too many attempts. Please wait an hour and try again."],
    [
      "verify_unavailable",
      "We couldn't check your password right now. Try again in a few minutes.",
    ],
    [
      "error",
      "We couldn't delete your account. Nothing was changed. Please try again.",
    ],
  ])("maps %s to its copy", async (code, copy) => {
    fake.deleteOwnAccount.mockResolvedValue({ ok: false, code });
    const state = await deleteAccountAction({}, form());
    expect(state.error).toBe(copy);
  });

  it("redirects to the sign-in path when not signed in", async () => {
    fake.deleteOwnAccount.mockResolvedValue({
      ok: false,
      code: "not_signed_in",
    });
    await expect(deleteAccountAction({}, form())).rejects.toMatchObject({
      url: "/login",
    });
  });

  it("never returns the password, even in values", async () => {
    for (const code of ["bad_confirmation", "bad_password", "error"]) {
      fake.deleteOwnAccount.mockResolvedValue({ ok: false, code });
      const state = await deleteAccountAction({}, form());
      expect(JSON.stringify(state)).not.toContain(PASSWORD);
      expect(state.values).not.toHaveProperty("password");
    }
    const missing = await deleteAccountAction({}, form({ confirmation: "x" }));
    expect(JSON.stringify(missing)).not.toContain(PASSWORD);
  });

  it("keeps what was typed in the confirmation box, and only that", async () => {
    fake.deleteOwnAccount.mockResolvedValue({
      ok: false,
      code: "bad_password",
    });
    const state = await deleteAccountAction({}, form());
    expect(state.values).toEqual({ confirmation: "DELETE" });
  });

  it("does not log the password", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.deleteOwnAccount.mockResolvedValue({ ok: false, code: "error" });
    await deleteAccountAction({}, form());
    expect(JSON.stringify(log.mock.calls)).not.toContain(PASSWORD);
    log.mockRestore();
  });
});

describe("deleteAccountAction without a password", () => {
  const REAUTH_COPY =
    "For your security, sign in again and then delete your account within 10 minutes.";

  function recentSignInForm(fields: Record<string, string> = {}) {
    const fd = new FormData();
    fd.set("confirmation", "DELETE");
    fd.set("method", "recent_sign_in");
    for (const [key, value] of Object.entries(fields)) fd.set(key, value);
    return fd;
  }

  it("does not ask for a password when the form is in recent sign-in mode", async () => {
    await expect(
      deleteAccountAction({}, recentSignInForm()),
    ).rejects.toMatchObject({ url: "/?account=deleted" });
    expect(fake.deleteOwnAccount).toHaveBeenCalledTimes(1);
    expect(fake.deleteOwnAccount).toHaveBeenCalledWith({
      confirmation: "DELETE",
      password: "",
    });
  });

  it("still passes a posted password on, since the service decides which method applies", async () => {
    await expect(
      deleteAccountAction({}, recentSignInForm({ password: PASSWORD })),
    ).rejects.toBeInstanceOf(RedirectError);
    expect(fake.deleteOwnAccount.mock.calls[0][0]).toEqual({
      confirmation: "DELETE",
      password: PASSWORD,
    });
  });

  it("still requires the confirmation word in that mode", async () => {
    const fd = recentSignInForm();
    fd.delete("confirmation");
    const state = await deleteAccountAction({}, fd);
    expect(state.error).toBe("Type DELETE exactly to confirm.");
    expect(fake.deleteOwnAccount).not.toHaveBeenCalled();
  });

  it("leaves the decision to the service: a password account still needs its password", async () => {
    fake.deleteOwnAccount.mockResolvedValue({
      ok: false,
      code: "bad_password",
    });
    const state = await deleteAccountAction({}, recentSignInForm());
    expect(state.error).toBe("That password isn't correct.");
  });

  it("maps reauth_required to its copy and a code the panel can act on", async () => {
    fake.deleteOwnAccount.mockResolvedValue({
      ok: false,
      code: "reauth_required",
    });
    const state = await deleteAccountAction({}, recentSignInForm());
    expect(state.error).toBe(REAUTH_COPY);
    expect(state.code).toBe("reauth_required");
    expect(state.values).toEqual({ confirmation: "DELETE" });
    expect(REAUTH_COPY).not.toMatch(/[–—]/);
  });

  it("gives no code for the other failures", async () => {
    fake.deleteOwnAccount.mockResolvedValue({ ok: false, code: "error" });
    const state = await deleteAccountAction({}, form());
    expect(state.code).toBeUndefined();
  });
});

describe("signInAgainAction", () => {
  it("signs out and sends the person to sign in, then back to settings", async () => {
    await expect(signInAgainAction()).rejects.toMatchObject({
      url: "/login?next=/settings",
    });
    expect(fake.signOut).toHaveBeenCalledTimes(1);
    expect(fake.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("still sends the person to sign in when signing out fails", async () => {
    fake.signOut.mockRejectedValue(new Error("no session"));
    await expect(signInAgainAction()).rejects.toMatchObject({
      url: "/login?next=/settings",
    });
    fake.createClient.mockRejectedValue(new Error("no cookies"));
    await expect(signInAgainAction()).rejects.toMatchObject({
      url: "/login?next=/settings",
    });
  });
});
