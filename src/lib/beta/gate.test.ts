import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BETA_CODE_FIELD,
  BETA_CODE_HOOK_ERROR,
  BETA_CODE_INVALID_MESSAGE,
  BETA_CODE_MAX_LENGTH,
  isBetaCodeError,
  isBetaGateOn,
  parseBetaCode,
} from "./gate";

describe("isBetaGateOn", () => {
  it("is on only for the word on, ignoring case and spaces", () => {
    for (const value of ["on", "ON", "On", " on ", "\ton\n"]) {
      expect(isBetaGateOn(value), JSON.stringify(value)).toBe(true);
    }
  });

  it("is off for anything else", () => {
    for (const value of [
      undefined,
      "",
      " ",
      "off",
      "true",
      "1",
      "yes",
      "onn",
      "o n",
    ]) {
      expect(isBetaGateOn(value), JSON.stringify(value)).toBe(false);
    }
  });

  it("reads BETA_GATE from the environment by default", () => {
    const before = process.env.BETA_GATE;
    try {
      process.env.BETA_GATE = "On";
      expect(isBetaGateOn()).toBe(true);
      process.env.BETA_GATE = "off";
      expect(isBetaGateOn()).toBe(false);
      delete process.env.BETA_GATE;
      expect(isBetaGateOn()).toBe(false);
    } finally {
      if (before === undefined) delete process.env.BETA_GATE;
      else process.env.BETA_GATE = before;
    }
  });
});

describe("parseBetaCode", () => {
  it("trims and accepts a normal code", () => {
    expect(parseBetaCode("  ABCD2345WXYZ \n")).toEqual({
      ok: true,
      code: "ABCD2345WXYZ",
    });
  });

  it("returns the canonical code: no spaces or hyphens, upper-case", () => {
    for (const raw of [
      "abcd2345wxyz",
      "ABCD-2345-WXYZ",
      "abcd 2345 wxyz",
      "  Abcd-2345 wxyz  ",
    ]) {
      expect(parseBetaCode(raw), raw).toEqual({
        ok: true,
        code: "ABCD2345WXYZ",
      });
    }
  });

  it("asks for a code when it is missing or blank", () => {
    for (const raw of [null, "", "   ", "- -", new File([], "x")]) {
      expect(parseBetaCode(raw)).toEqual({
        ok: false,
        error: "Enter your invite code.",
      });
    }
  });

  it("gives the single not-valid message for an over-long code", () => {
    expect(parseBetaCode("A".repeat(BETA_CODE_MAX_LENGTH))).toMatchObject({
      ok: true,
    });
    expect(parseBetaCode("A".repeat(BETA_CODE_MAX_LENGTH + 1))).toEqual({
      ok: false,
      error: BETA_CODE_INVALID_MESSAGE,
    });
  });

  it("uses one message that does not tell unknown from used up", () => {
    expect(BETA_CODE_INVALID_MESSAGE).toBe(
      "That invite code isn't valid or has been used up.",
    );
  });
});

describe("isBetaCodeError", () => {
  it("recognises the hook's rejection by its message", () => {
    expect(isBetaCodeError({ message: BETA_CODE_HOOK_ERROR })).toBe(true);
    expect(
      isBetaCodeError({ message: `Hook said: ${BETA_CODE_HOOK_ERROR}` }),
    ).toBe(true);
    expect(isBetaCodeError({ message: "Something else" })).toBe(false);
    expect(isBetaCodeError({})).toBe(false);
  });
});

describe("agreement with the migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/20261001110000_beta_gate.sql"),
    "utf8",
  );

  it("normalises the code with the same rule as the hook and the check", () => {
    // The rule itself is tested in code.test.ts; here only that SQL has it.
    const rule = "upper(regexp_replace(";
    expect(sql.split(rule)).toHaveLength(3);
    expect(sql).toContain("create or replace function public.check_beta_code");
  });

  it("uses the same field name, error message and length limit", () => {
    expect(BETA_CODE_FIELD).toBe("betaCode");
    expect(sql).toContain(`'${BETA_CODE_HOOK_ERROR}'`);
    expect(sql).toContain(`> ${BETA_CODE_MAX_LENGTH}`);
  });
});
