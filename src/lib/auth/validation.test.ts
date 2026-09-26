import { describe, expect, it } from "vitest";
import {
  forgotPasswordSchema,
  onboardingSchema,
  resetPasswordSchema,
  signUpSchema,
} from "./validation";

// Generated per run so the source holds no password-like literals for
// secret scanners to flag.
const VALID_PASSWORD = crypto.randomUUID();
const OTHER_PASSWORD = crypto.randomUUID();
const TOO_SHORT = "x".repeat(5);

describe("signUpSchema", () => {
  it("accepts valid input and trims the display name", () => {
    const result = signUpSchema.parse({
      displayName: "  Ari  ",
      email: "ari@example.com",
      password: VALID_PASSWORD,
    });
    expect(result.displayName).toBe("Ari");
  });

  it("rejects short passwords and invalid emails", () => {
    const result = signUpSchema.safeParse({
      displayName: "Ari",
      email: "nope",
      password: TOO_SHORT,
    });
    expect(result.success).toBe(false);
    const fields = result.error!.issues.map((i) => i.path[0]);
    expect(fields).toEqual(expect.arrayContaining(["email", "password"]));
  });

  it("rejects passwords beyond the 72-byte bcrypt limit", () => {
    const result = signUpSchema.safeParse({
      displayName: "Ari",
      email: "ari@example.com",
      password: "x".repeat(73),
    });
    expect(result.success).toBe(false);
  });
});

describe("onboardingSchema", () => {
  it("requires both confirmations", () => {
    expect(
      onboardingSchema.safeParse({ ageConfirmed: true, policiesAccepted: true })
        .success,
    ).toBe(true);
    expect(
      onboardingSchema.safeParse({
        ageConfirmed: true,
        policiesAccepted: false,
      }).success,
    ).toBe(false);
    expect(
      onboardingSchema.safeParse({
        ageConfirmed: false,
        policiesAccepted: true,
      }).success,
    ).toBe(false);
  });
});

describe("forgotPasswordSchema", () => {
  it("requires a valid email", () => {
    expect(
      forgotPasswordSchema.safeParse({ email: "ari@example.com" }).success,
    ).toBe(true);
    expect(forgotPasswordSchema.safeParse({ email: "nope" }).success).toBe(
      false,
    );
  });
});

describe("resetPasswordSchema", () => {
  it("accepts matching passwords that meet the rules", () => {
    const result = resetPasswordSchema.safeParse({
      password: VALID_PASSWORD,
      confirmPassword: VALID_PASSWORD,
    });
    expect(result.success).toBe(true);
  });

  it("flags a mismatch on the confirmation field", () => {
    const result = resetPasswordSchema.safeParse({
      password: VALID_PASSWORD,
      confirmPassword: OTHER_PASSWORD,
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].path).toEqual(["confirmPassword"]);
  });

  it("applies the same strength rules as sign-up", () => {
    const result = resetPasswordSchema.safeParse({
      password: TOO_SHORT,
      confirmPassword: TOO_SHORT,
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].path).toEqual(["password"]);
  });
});
