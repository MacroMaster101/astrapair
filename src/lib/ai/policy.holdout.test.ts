import { beforeAll, describe, expect, it } from "vitest";
import {
  findPolicyFlags,
  findPolicyViolations,
  warmPolicyEngines,
} from "./policy";
import { HOLDOUT, HOLDOUT_NAMES, type HoldoutRow } from "./policy.holdout";
import { REVIEW2, REVIEW2_NAMES, type Review2Row } from "./policy.review2";
import { REVIEW3, type Review3Row } from "./policy.review3";
import { REVIEW4, type Review4Row } from "./policy.review4";
import { REVIEW5, type Review5Row } from "./policy.review5";
import { REVIEW6, type Review6Row } from "./policy.review6";

// Two sets of sentences that were written and labelled by hand from the tier
// definitions, and not from what the engine does:
//   - policy.holdout.ts, written before any rule of fix round 3 was changed;
//   - policy.review2.ts, every sentence the round 2 review printed.
// Nothing here tunes a label to a run. First-run numbers of the hold-out against
// the round 2 engine (recorded in task-8-report.md): 22 of 100 benign sentences
// blocked, 25 of 62 violating sentences blocked, 0 of 4 negated directives
// reported by the flag tier only. The assertions below are the final numbers.

// Compile the patterns before the first case, so a loaded machine cannot time it out.
beforeAll(() => {
  warmPolicyEngines();
}, 60_000);

const options = (row: { names?: boolean }, names: string[]) =>
  row.names ? { names } : undefined;

function verdict(
  row: { label: string; text: string; names?: boolean },
  names: string[],
) {
  const o = options(row, names);
  const blocked = findPolicyViolations(row.text, o).length > 0;
  const flagged = findPolicyFlags(row.text, o).length > 0;
  return { blocked, flagged };
}

const holdout = (rows: HoldoutRow[]) =>
  rows.map((r) => ({ ...r, ...verdict(r, HOLDOUT_NAMES) }));

describe("hold-out", () => {
  const rows = holdout(HOLDOUT);
  const benign = rows.filter((r) => r.label === "clean");
  const violating = rows.filter((r) => r.label === "block");
  const negated = rows.filter((r) => r.label === "flag");

  it("has at least 80 benign and 40 violating sentences", () => {
    expect(benign).toHaveLength(100);
    expect(violating).toHaveLength(62);
    expect(negated).toHaveLength(4);
    expect(new Set(rows.map((r) => r.text)).size).toBe(rows.length);
  });

  it("blocks none of the benign sentences (0 per 100, the limit is 2)", () => {
    expect(benign.filter((r) => r.blocked).map((r) => r.text)).toEqual([]);
  });

  it("blocks all of the violating sentences", () => {
    expect(violating.filter((r) => !r.blocked).map((r) => r.text)).toEqual([]);
  });

  it("leaves a negated leave, break up, split up or divorce to the flag tier", () => {
    expect(negated.filter((r) => r.blocked || !r.flagged)).toEqual([]);
  });

  it.each(rows.map((r) => [r.group, r.label, r.text, r] as const))(
    "%s (%s): %s",
    (_group, label, _text, r) => {
      if (label === "block") expect(r.blocked).toBe(true);
      else if (label === "flag") {
        expect(r.blocked).toBe(false);
        expect(r.flagged).toBe(true);
      } else expect(r.blocked).toBe(false);
    },
  );

  it("needs the names for the rows that use them", () => {
    const named = HOLDOUT.filter((r) => r.names && r.label === "block");
    expect(named.length).toBeGreaterThanOrEqual(10);
    // Without the names the filter cannot know who "Sam" is.
    const unaware = named.filter(
      (r) => findPolicyViolations(r.text).length === 0,
    );
    expect(unaware.length).toBeGreaterThanOrEqual(8);
  });
});

describe("round 2 review sentences", () => {
  const rows = REVIEW2.map((r: Review2Row) => ({
    ...r,
    ...verdict(r, REVIEW2_NAMES),
  }));

  it("keeps its counts by label", () => {
    const count = (label: string) =>
      rows.filter((r) => r.label === label).length;
    expect({
      block: count("block"),
      flag: count("flag"),
      clean: count("clean"),
      gap: count("gap"),
    }).toEqual({ block: 74, flag: 19, clean: 70, gap: 15 });
  });

  it("has no block-tier false positive and no block-tier miss", () => {
    const wrong = rows.filter((r) =>
      r.label === "block" ? !r.blocked : r.blocked,
    );
    expect(wrong.map((r) => r.text)).toEqual([]);
  });

  it("reports every 'flag' row in the flag tier only", () => {
    expect(
      rows.filter((r) => r.label === "flag" && (r.blocked || !r.flagged)),
    ).toEqual([]);
  });

  it.each(rows.map((r) => [r.group, r.label, r.text, r] as const))(
    "%s (%s): %s",
    (_group, label, _text, r) => {
      if (label === "block") expect(r.blocked).toBe(true);
      else if (label === "flag") {
        expect(r.blocked).toBe(false);
        expect(r.flagged).toBe(true);
      } else expect(r.blocked).toBe(false);
    },
  );
});

describe("round 3 review sentences", () => {
  const rows = REVIEW3.map((r: Review3Row) => {
    const o = r.names ? { names: r.names } : undefined;
    return {
      ...r,
      blocked: findPolicyViolations(r.text, o).length > 0,
      flagged: findPolicyFlags(r.text, o).length > 0,
    };
  });

  it("keeps its counts by label", () => {
    const count = (label: string) =>
      rows.filter((r) => r.label === label).length;
    expect({
      block: count("block"),
      flag: count("flag"),
      clean: count("clean"),
      gap: count("gap"),
    }).toEqual({ block: 49, flag: 6, clean: 44, gap: 3 });
  });

  it("has no block-tier false positive and no block-tier miss", () => {
    const wrong = rows.filter((r) =>
      r.label === "block" ? !r.blocked : r.blocked,
    );
    expect(wrong.map((r) => r.text)).toEqual([]);
  });

  it("reports every 'flag' row in the flag tier only", () => {
    expect(
      rows.filter((r) => r.label === "flag" && (r.blocked || !r.flagged)),
    ).toEqual([]);
  });

  it.each(rows.map((r) => [r.group, r.label, r.text, r] as const))(
    "%s (%s): %s",
    (_group, label, _text, r) => {
      if (label === "block") expect(r.blocked).toBe(true);
      else if (label === "flag") {
        expect(r.blocked).toBe(false);
        expect(r.flagged).toBe(true);
      } else expect(r.blocked).toBe(false);
    },
  );

  // Ruling, fix round 3 and 4: clause-initial imperatives are limited to the
  // leave family, so a negated imperative marry or propose is flag tier only;
  // the modal forms ("you shouldn't marry him") still block.
  it("pins the ruling on a negated imperative marry or propose", () => {
    for (const text of [
      "Don't marry him.",
      "Never marry him.",
      "Do not propose to her.",
    ]) {
      expect(findPolicyViolations(text), text).toEqual([]);
      expect(findPolicyFlags(text).length, text).toBeGreaterThan(0);
    }
    expect(findPolicyViolations("You shouldn't marry him.")).not.toEqual([]);
  });
});

describe("round 4 review sentences", () => {
  const rows = REVIEW4.map((r: Review4Row) => {
    const o = r.names ? { names: r.names } : undefined;
    return {
      ...r,
      blocked: findPolicyViolations(r.text, o).length > 0,
      flagged: findPolicyFlags(r.text, o).length > 0,
    };
  });

  it("keeps its counts by label", () => {
    const count = (label: string) =>
      rows.filter((r) => r.label === label).length;
    expect({
      block: count("block"),
      flag: count("flag"),
      clean: count("clean"),
      gap: count("gap"),
    }).toEqual({ block: 42, flag: 0, clean: 45, gap: 2 });
  });

  it("has no block-tier false positive and no block-tier miss", () => {
    const wrong = rows.filter((r) =>
      r.label === "block" ? !r.blocked : r.blocked,
    );
    expect(wrong.map((r) => r.text)).toEqual([]);
  });

  it.each(rows.map((r) => [r.group, r.label, r.text, r] as const))(
    "%s (%s): %s",
    (_group, label, _text, r) => {
      if (label === "block") expect(r.blocked).toBe(true);
      else expect(r.blocked).toBe(false);
    },
  );
});

describe("round 5 review sentences and the closing change", () => {
  const rows = REVIEW5.map((r: Review5Row) => {
    const o = r.names ? { names: r.names } : undefined;
    return { ...r, blocked: findPolicyViolations(r.text, o).length > 0 };
  });

  it("keeps its counts by label", () => {
    const count = (label: string) =>
      rows.filter((r) => r.label === label).length;
    expect({ block: count("block"), clean: count("clean") }).toEqual({
      block: 30,
      clean: 21,
    });
  });

  it("has no block-tier false positive and no block-tier miss", () => {
    const wrong = rows.filter((r) =>
      r.label === "block" ? !r.blocked : r.blocked,
    );
    expect(wrong.map((r) => r.text)).toEqual([]);
  });

  it.each(rows.map((r) => [r.group, r.label, r.text, r] as const))(
    "%s (%s): %s",
    (_group, label, _text, r) => {
      expect(r.blocked).toBe(label === "block");
    },
  );

  it("reads what follows a semicolon as part of what follows", () => {
    expect(
      findPolicyViolations(
        "A site said you're 38% compatible; that is just a quiz result, and I wouldn't read anything into it.",
      ),
    ).toEqual([]);
    expect(
      findPolicyViolations(
        "A site said you're 38% compatible; I agree, that is about right.",
      ),
    ).not.toEqual([]);
  });

  it("keeps the stricter rule for an authority that is not set aside", () => {
    expect(
      findPolicyViolations("Many astrologers would call this marriage doomed."),
    ).not.toEqual([]);
    expect(
      findPolicyViolations(
        "Many astrologers would call this marriage doomed, but I don't read it that way.",
      ),
    ).toEqual([]);
  });
});

describe("round 6 review sentences: the residual limits of the closing measurement", () => {
  const rows = REVIEW6.map((r: Review6Row) => {
    const o = r.names ? { names: r.names } : undefined;
    return { ...r, blocked: findPolicyViolations(r.text, o).length > 0 };
  });

  it("keeps its counts by label", () => {
    const count = (label: string) =>
      rows.filter((r) => r.label === label).length;
    expect({ block: count("block"), clean: count("clean") }).toEqual({
      block: 77,
      clean: 84,
    });
  });

  it("has no block-tier false positive and no block-tier miss", () => {
    const wrong = rows.filter((r) =>
      r.label === "block" ? !r.blocked : r.blocked,
    );
    expect(wrong.map((r) => r.text)).toEqual([]);
  });

  it.each(rows.map((r) => [r.group, r.label, r.text, r] as const))(
    "%s (%s): %s",
    (_group, label, _text, r) => {
      expect(r.blocked).toBe(label === "block");
    },
  );
});
