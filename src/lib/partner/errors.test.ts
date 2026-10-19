import { describe, expect, it } from "vitest";
import {
  GENERIC_PARTNER_ERROR,
  partnerErrorCode,
  partnerErrorMessage,
} from "./errors";

describe("partner error mapping", () => {
  it("maps known function codes", () => {
    expect(partnerErrorCode({ message: "invite_expired" })).toBe(
      "invite_expired",
    );
    expect(partnerErrorMessage({ message: "self_invite" })).toMatch(
      /your own invite/i,
    );
  });

  it("treats a unique violation as already connected", () => {
    expect(
      partnerErrorCode({ code: "23505", message: "duplicate key value" }),
    ).toBe("already_connected");
  });

  it("never echoes unknown database text", () => {
    expect(
      partnerErrorMessage({ message: 'relation "x" does not exist' }),
    ).toBe(GENERIC_PARTNER_ERROR);
    expect(partnerErrorMessage(null)).toBe(GENERIC_PARTNER_ERROR);
  });
});
