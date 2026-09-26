import { z } from "zod";

// Supabase hashes with bcrypt, which ignores bytes past 72.
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(72, "Password must be at most 72 characters.");

export const emailSchema = z.email("Enter a valid email address.").max(254);

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a display name.")
  .max(80, "Display name must be at most 80 characters.");

export const signUpSchema = z.object({
  displayName: displayNameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match.",
    path: ["confirmPassword"],
  });

export const onboardingSchema = z.object({
  ageConfirmed: z.literal(true, "You must confirm you are 18 or older."),
  policiesAccepted: z.literal(
    true,
    "You must accept the Terms and Privacy Policy.",
  ),
});

export type FormState = {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  message?: string;
  /** Submitted non-secret values, so fields survive React's post-action form reset. */
  values?: Record<string, string>;
};

export function toFieldErrors(error: z.ZodError): FormState {
  return {
    fieldErrors: z.flattenError(error).fieldErrors as FormState["fieldErrors"],
  };
}

export function formValues(formData: FormData, names: string[]) {
  return Object.fromEntries(
    names.map((n) => [n, String(formData.get(n) ?? "")]),
  );
}
