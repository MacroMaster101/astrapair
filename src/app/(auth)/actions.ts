"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/routes";
import {
  forgotPasswordSchema,
  formValues,
  signInSchema,
  signUpSchema,
  toFieldErrors,
  type FormState,
} from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/server";

const RATE_LIMITED: FormState = {
  error: "Too many attempts. Please wait a few minutes and try again.",
};

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
  const { data, error } = await supabase.auth.signUp({
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
      return RATE_LIMITED;
    }
    // Existing emails are not revealed: with email confirmation on, Supabase
    // returns success for them too.
    return { error: "We couldn't create your account. Please try again." };
  }

  // With email confirmation disabled, Supabase signs the user in immediately.
  if (data.session) redirect("/onboarding");

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
    if (error.status === 429) return RATE_LIMITED;
    return { error: "Incorrect email or password." };
  }

  redirect(safeNextPath(formData.get("next")?.toString()));
}

export async function requestPasswordReset(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData, ["email"]);
  const parsed = forgotPasswordSchema.safeParse(values);
  if (!parsed.success) return { ...toFieldErrors(parsed.error), values };

  const origin = (await headers()).get("origin");
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(
    parsed.data.email,
    { redirectTo: `${origin}/auth/callback?next=/reset-password` },
  );

  if (error?.status === 429) return { ...RATE_LIMITED, values };
  if (error) {
    return { error: "We couldn't send the email. Please try again.", values };
  }

  // Same response whether or not the account exists, so emails can't be probed.
  return { message: parsed.data.email, values };
}
