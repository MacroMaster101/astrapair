"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/routes";
import {
  formValues,
  signInSchema,
  signUpSchema,
  toFieldErrors,
  type FormState,
} from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/server";

export async function signUp(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const result = await createAccount(formData);
  return { ...result, values: formValues(formData, ["displayName", "email"]) };
}

async function createAccount(formData: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse({
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return toFieldErrors(parsed.error);

  // Server Actions reject cross-origin requests, so Origin is trustworthy here.
  const origin = (await headers()).get("origin");
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: `${origin}/auth/callback?next=/onboarding`,
    },
  });

  if (error) {
    if (error.code === "weak_password") {
      return { fieldErrors: { password: ["Choose a stronger password."] } };
    }
    if (error.code === "over_email_send_rate_limit" || error.status === 429) {
      return {
        error: "Too many attempts. Please wait a few minutes and try again.",
      };
    }
    // Existing emails are not revealed: Supabase returns success for them too.
    return { error: "We couldn't create your account. Please try again." };
  }

  redirect(`/check-email?email=${encodeURIComponent(parsed.data.email)}`);
}

export async function signIn(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const result = await authenticate(formData);
  return { ...result, values: formValues(formData, ["email"]) };
}

async function authenticate(formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return toFieldErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    if (error.code === "email_not_confirmed") {
      return {
        error:
          "Please confirm your email address first. Check your inbox for the link.",
      };
    }
    if (error.status === 429) {
      return {
        error: "Too many attempts. Please wait a few minutes and try again.",
      };
    }
    return { error: "Incorrect email or password." };
  }

  redirect(safeNextPath(formData.get("next")?.toString()));
}
