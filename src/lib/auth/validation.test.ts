import { describe, expect, it } from "vitest";
import { onboardingSchema, signUpSchema } from "./validation";

describe("signUpSchema", () => {
  it("accepts valid input and trims the display name", () => {
    const result = signUpSchema.parse({
      displayName: "  Ari  ",
      email: "ari@example.com",
      password: "correct-horse",
    });
    expect(result.displayName).toBe("Ari");
  });

  it("rejects short passwords and invalid emails", () => {
    const result = signUpSchema.safeParse({
      displayName: "Ari",
      email: "nope",
      password: "short",
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
