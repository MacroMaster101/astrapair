"use server";

import { requireUserId } from "@/lib/auth/session";
import {
  resetPasswordSchema,
  toFieldErrors,
  type FormState,
} from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/server";

export async function updatePassword(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUserId();

  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return toFieldErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    if (error.code === "same_password") {
      return {
        fieldErrors: {
          password: ["Choose a password different from your current one."],
        },
      };
    }
    if (error.code === "weak_password") {
      return { fieldErrors: { password: ["Choose a stronger password."] } };
    }
    if (error.code === "reauthentication_needed") {
      return {
        error:
          "For your security, request a new reset link and use it right away.",
      };
    }
    return { error: "We couldn't update your password. Please try again." };
  }

  // Anyone else holding an old session (e.g. whoever knew the old password)
  // is signed out; this device keeps its session.
  await supabase.auth.signOut({ scope: "others" });

  return { message: "Password updated." };
}
