import { describe, expect, it } from "vitest";
import {
  ALPHABET,
  CODE_LENGTH,
  DEFAULT_USES,
  MAX_LABEL_LENGTH,
  MAX_USES,
  formatCode,
  generateCode,
  hashCode,
  normalizeCode,
  parseCommand,
} from "../../../scripts/ops/lib/beta-code-core.mjs";

describe("generateCode", () => {
  it("makes a 12 character code from the unambiguous alphabet", () => {
    expect(CODE_LENGTH).toBe(12);
    for (let i = 0; i < 200; i += 1) {
      const code = generateCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect(code).toMatch(new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`));
    }
  });

  it("leaves out characters that are easy to confuse", () => {
    for (const ch of ["0", "O", "1", "I", "L", "l"]) {
      expect(ALPHABET).not.toContain(ch);
    }
    expect(new Set(ALPHABET).size).toBe(ALPHABET.length);
  });

  it("draws every character from the random source across the whole alphabet", () => {
    const calls: number[] = [];
    const randomInt = (max: number) => {
      calls.push(max);
      return calls.length - 1;
    };
    const code = generateCode(randomInt);
    expect(calls).toEqual(Array(CODE_LENGTH).fill(ALPHABET.length));
    expect(code).toBe(ALPHABET.slice(0, CODE_LENGTH));
  });

  it("does not repeat across a batch", () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateCode()));
    expect(codes.size).toBe(500);
  });
});

describe("normalizeCode", () => {
  it("trims, drops spaces and hyphens, and upper-cases", () => {
    expect(normalizeCode("  abcd-2345-wxyz \n")).toBe("ABCD2345WXYZ");
    expect(normalizeCode("ab cd\t23-45 WX\u00a0yz")).toBe("ABCD2345WXYZ");
    expect(normalizeCode("---")).toBe("");
    expect(normalizeCode("")).toBe("");
  });

  it("leaves a canonical code alone and is idempotent", () => {
    const code = generateCode();
    expect(normalizeCode(code)).toBe(code);
    expect(normalizeCode(normalizeCode("a-b c"))).toBe(normalizeCode("a-b c"));
  });
});

describe("formatCode", () => {
  it("groups a code in fours with hyphens", () => {
    expect(formatCode("ABCD2345WXYZ")).toBe("ABCD-2345-WXYZ");
  });

  it("reads back to the same code", () => {
    const code = generateCode();
    expect(formatCode(code)).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(normalizeCode(formatCode(code))).toBe(code);
  });
});

describe("hashCode", () => {
  it("is the sha256 hex of the utf8 text of the normalised code", () => {
    // sha256 of "ABC".
    expect(hashCode("ABC")).toBe(
      "b5d4045c3f466fa91fe2cc6abe79232a1a57cdf104f7a26e716e0a1e2789df78",
    );
  });

  it("gives grouped, lower-case and spaced inputs the canonical hash", () => {
    const code = generateCode();
    const canonical = hashCode(code);
    expect(hashCode(formatCode(code))).toBe(canonical);
    expect(hashCode(code.toLowerCase())).toBe(canonical);
    expect(hashCode(formatCode(code).toLowerCase())).toBe(canonical);
    expect(hashCode(` ${code.slice(0, 6)} ${code.slice(6)}\n`)).toBe(canonical);
    expect(hashCode("ABCD2345WXYZ")).toBe(hashCode("abcd 2345 wxyz"));
  });

  it("keeps different codes different", () => {
    expect(hashCode("ABCD2345WXYZ")).not.toBe(hashCode("ABCD2345WXYY"));
  });

  it("always looks like the column check allows", () => {
    expect(hashCode(generateCode())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes non-ascii text as utf8, like the database does", () => {
    // sha256 of the two bytes c3 89 (the upper-case of e acute).
    expect(hashCode("é")).toBe(
      "a755f65d4e5201d92b6f264d1508ea0bec9913dd7b20a96ebde25de3cda84a84",
    );
  });
});

describe("parseCommand", () => {
  it("parses create with a default of one use", () => {
    expect(parseCommand(["create", "friends"])).toEqual({
      command: "create",
      label: "friends",
      uses: DEFAULT_USES,
    });
  });

  it("parses --uses in both spellings", () => {
    expect(parseCommand(["create", "family", "--uses", "5"])).toMatchObject({
      uses: 5,
    });
    expect(parseCommand(["create", "family", "--uses=7"])).toMatchObject({
      uses: 7,
    });
    expect(parseCommand(["create", "--uses", "3", "family"])).toMatchObject({
      label: "family",
      uses: 3,
    });
  });

  it("parses list and disable", () => {
    expect(parseCommand(["list"])).toEqual({ command: "list" });
    expect(parseCommand(["disable", "friends"])).toEqual({
      command: "disable",
      label: "friends",
    });
  });

  it("rejects bad input with a usage message", () => {
    const bad: string[][] = [
      [],
      ["frobnicate"],
      ["create"],
      ["create", ""],
      ["create", "   "],
      ["create", "x".repeat(MAX_LABEL_LENGTH + 1)],
      ["create", "a", "b"],
      ["create", "a", "--uses"],
      ["create", "a", "--uses", "0"],
      ["create", "a", "--uses", "-2"],
      ["create", "a", "--uses", "2.5"],
      ["create", "a", "--uses", "many"],
      ["create", "a", "--uses", String(MAX_USES + 1)],
      ["create", "a", "--unknown"],
      ["list", "extra"],
      ["disable"],
      ["disable", "a", "b"],
    ];
    for (const argv of bad) {
      expect(() => parseCommand(argv), JSON.stringify(argv)).toThrow(
        /usage|label|uses|command/i,
      );
    }
  });

  it("trims the label", () => {
    expect(parseCommand(["create", "  friends  "])).toMatchObject({
      label: "friends",
    });
  });
});
