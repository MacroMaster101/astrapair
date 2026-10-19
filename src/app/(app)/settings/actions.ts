"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { deleteOwnAccount } from "@/lib/account/deletion";
import { SIGN_IN_PATH } from "@/lib/auth/routes";
import { requireUserId } from "@/lib/auth/session";
import {
  displayNameSchema,
  toFieldErrors,
  type FormState,
} from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/server";

const profileSchema = z.object({ displayName: displayNameSchema });

export async function updateProfile(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await requireUserId();

  const parsed = profileSchema.safeParse({
    displayName: formData.get("displayName"),
  });
  if (!parsed.success) return toFieldErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: parsed.data.displayName })
    .eq("id", userId);
  if (error)
    return { error: "We couldn't save your profile. Please try again." };

  revalidatePath("/", "layout");
  return { message: "Profile saved." };
}

const DELETE_COPY = {
  bad_confirmation: "Type DELETE exactly to confirm.",
  bad_password: "That password isn't correct.",
  verify_unavailable:
    "We couldn't check your password right now. Try again in a few minutes.",
  reauth_required:
    "For your security, sign in again and then delete your account within 10 minutes.",
  rate_limited: "Too many attempts. Please wait an hour and try again.",
  error:
    "We couldn't delete your account. Nothing was changed. Please try again.",
} as const;

export async function deleteAccountAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const confirmation = formData.get("confirmation");
  const password = formData.get("password");
  // The panel sets this when the account has no password. It only skips the
  // early "enter your password" check: the service decides from the signed-in
  // user which method applies, so it cannot be used to skip the password.
  const recentSignIn = formData.get("method") === "recent_sign_in";
  // Only the confirmation word is ever sent back to the form. The password is
  // never returned or logged.
  const values = {
    confirmation: typeof confirmation === "string" ? confirmation : "",
  };

  if (typeof confirmation !== "string") {
    return { error: DELETE_COPY.bad_confirmation, values };
  }
  if (!recentSignIn && (typeof password !== "string" || password === "")) {
    return { fieldErrors: { password: ["Enter your password."] }, values };
  }

  const result = await deleteOwnAccount({
    confirmation,
    password: typeof password === "string" ? password : "",
  });
  if (!result.ok) {
    if (result.code === "not_signed_in") redirect(SIGN_IN_PATH);
    if (result.code === "reauth_required") {
      return { error: DELETE_COPY.reauth_required, code: result.code, values };
    }
    return { error: DELETE_COPY[result.code], values };
  }

  redirect("/?account=deleted");
}

/** Ends the session and returns to sign-in, then to settings to finish deleting. */
export async function signInAgainAction(): Promise<void> {
  try {
    const supabase = await createClient();
    // This session only: the person's other devices stay signed in.
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Still send the person to sign in.
  }
  redirect(`${SIGN_IN_PATH}?next=/settings`);
}
