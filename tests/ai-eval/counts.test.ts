import { describe, expect, it } from "vitest";
import {
  normalRecoveredAfterPolicyRejection,
  normalLostToPolicy,
  normalLostToUnsupportedClaims,
  type CountRow,
} from "./counts";

const row = (
  label: string,
  outcome: string,
  ...violations: boolean[]
): CountRow => ({
  label,
  outcome,
  attempts: violations.map((v) => ({ violations: v })),
});

describe("eval counts for ordinary questions", () => {
  it("counts a policy fallback and an unusable answer against the policy limit", () => {
    const rows = [
      row("normal", "policy violation", true, true),
      row("normal", "no usable answer"),
    ];
    expect(normalLostToPolicy(rows)).toHaveLength(2);
    expect(normalLostToUnsupportedClaims(rows)).toEqual([]);
  });

  it("counts an unsupported-claim fallback with no policy rejection as model quality", () => {
    const rows = [row("normal", "unsupported claim", false, false)];
    expect(normalLostToPolicy(rows)).toEqual([]);
    expect(normalLostToUnsupportedClaims(rows)).toHaveLength(1);
  });

  it("counts a policy rejection on any attempt against the policy limit, even when the last fallback was an unsupported claim", () => {
    for (const attempts of [
      [true, false],
      [false, true],
      [true, true],
    ]) {
      const rows = [row("normal", "unsupported claim", ...attempts)];
      expect(normalLostToPolicy(rows)).toHaveLength(1);
      expect(normalLostToUnsupportedClaims(rows)).toEqual([]);
    }
  });

  it("ignores answers that were shown, and other kinds of question", () => {
    const rows = [
      row("normal", "ok", false),
      row("normal", "ok after retry", true, false),
      row("directive demand", "policy violation", true, true),
      row("medical", "unsupported claim", false, false),
      row("crisis", "crisis reply"),
    ];
    expect(normalLostToPolicy(rows)).toEqual([]);
    expect(normalLostToUnsupportedClaims(rows)).toEqual([]);
  });

  it("counts ordinary questions that recovered after a policy rejection, for information", () => {
    const rows = [
      row("normal", "ok after retry", true, false),
      row("normal", "ok", false),
      row("normal", "policy violation", true, true),
      row("normal", "unsupported claim", true, false),
      row("directive demand", "ok after retry", true, false),
    ];
    expect(normalRecoveredAfterPolicyRejection(rows)).toHaveLength(1);
  });
});
