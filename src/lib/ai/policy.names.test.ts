import { beforeAll, describe, expect, it } from "vitest";
import {
  findPolicyFlags,
  findPolicyViolations,
  warmPolicyEngines,
} from "./policy";

beforeAll(() => {
  warmPolicyEngines();
}, 60_000);

// Names in any script, and the cost of changing the set of names from call to
// call (fix round 4). A supplied name is replaced in the text by one fixed word
// before scanning, with an expression that treats letters, marks and digits of
// every script as part of a name.

const SINHALA = "කවිෂ"; // a Sinhala name
const SINHALA_ZWJ = "ප්‍රියා"; // with a zero-width joiner
const TAMIL = "கவிஷ்"; // a Tamil name

describe("names in other scripts", () => {
  const names = ["Élodie", "Zoë", SINHALA, SINHALA_ZWJ, TAMIL];

  it.each([
    ["Élodie will cheat.", "prediction"],
    ["Élodie is a narcissist.", "diagnosis"],
    ["You should leave Élodie.", "directive"],
    ["Zoë is going to cheat.", "prediction"],
    ["You should marry Zoë.", "directive"],
    [`${SINHALA} will cheat.`, "prediction"],
    [`${SINHALA} has ADHD.`, "diagnosis"],
    [`You should leave ${SINHALA}.`, "directive"],
    [`You and ${TAMIL} will break up.`, "prediction"],
    [`You should leave ${TAMIL}.`, "directive"],
    [`${SINHALA_ZWJ} will cheat.`, "prediction"],
    ["YOU SHOULD LEAVE ÉLODIE.", "directive"],
  ])("blocks %j as %s", (text, category) => {
    expect(
      findPolicyViolations(text, { names }).map((v) => v.category),
    ).toContain(category);
  });

  it("does not know the names without the option", () => {
    expect(findPolicyViolations(`${SINHALA} will cheat.`)).toEqual([]);
    expect(findPolicyViolations("Élodie will cheat.")).toEqual([]);
  });

  it("matches whole names only, in any script", () => {
    for (const text of [
      "Zoës will cheat.",
      "Élodiex is a narcissist.",
      "Élodie's keys are on the table.",
      `${SINHALA}ා will cheat.`,
      "You should call Élodie tonight.",
      "Leave Zoë a note.",
    ])
      expect(findPolicyViolations(text, { names }), text).toEqual([]);
  });

  it("reads such a name in the flag tier too", () => {
    expect(
      findPolicyFlags("Élodie is depressed.", { names }).map((v) => v.category),
    ).toEqual(["diagnosis"]);
    expect(findPolicyFlags(`${SINHALA} is depressed.`, { names })).not.toEqual(
      [],
    );
  });

  it("treats a name as literal text, whatever characters it holds", () => {
    const hostile = {
      names: ["(a+)+$", "Sam|.*", "[[[[", `${"x".repeat(39)}(`, "\\p{L}", "á"],
    };
    expect(() =>
      findPolicyViolations("You should leave (a+)+$.", hostile),
    ).not.toThrow();
    expect(
      findPolicyViolations("You should leave (a+)+$.", hostile),
    ).not.toEqual([]);
    expect(findPolicyViolations("You should leave anything.", hostile)).toEqual(
      [],
    );
  });
});

describe("changing the names from call to call", () => {
  // 300 different couples, more than the 256 name sets kept. One engine pair
  // serves all of them, so rotating through more sets than the cache holds
  // costs a small expression per call, never a rebuild of the rules.
  const SETS = 300;
  const couple = (i: number) => ({ names: [`Alpha${i}`, `Beta${i}`] });

  it("stays under a per-call budget when rotating over more sets than the cache holds", () => {
    findPolicyViolations("warm up", couple(0));
    findPolicyFlags("warm up", couple(0));
    const text =
      "You should leave Alpha7. Beta7 will cheat. Fine weather today.";
    const calls = 2 * SETS;
    const started = performance.now();
    for (let round = 0; round < 2; round++)
      for (let i = 0; i < SETS; i++) {
        findPolicyViolations(text, couple(i));
        findPolicyFlags(text, couple(i));
      }
    const perCall = (performance.now() - started) / (2 * calls);
    expect(perCall).toBeLessThan(5);
  });

  it("still answers correctly for a set that was pushed out of the cache", () => {
    for (let i = 0; i < SETS + 5; i++) findPolicyViolations("x", couple(i));
    expect(
      findPolicyViolations("You should leave Alpha0.", couple(0)),
    ).not.toEqual([]);
    expect(findPolicyViolations("You should leave Alpha0.", couple(1))).toEqual(
      [],
    );
  });

  it("gives the same answer whatever the order of the names", () => {
    const a = findPolicyViolations("Beta3 will cheat.", {
      names: ["Alpha3", "Beta3"],
    });
    const b = findPolicyViolations("Beta3 will cheat.", {
      names: ["Beta3", "Alpha3"],
    });
    expect(a.length).toBe(1);
    expect(b).toEqual(a);
  });
});

describe("names that are also ordinary words", () => {
  const will = { names: ["Will", "Priya"] };

  it("keeps every 'will' forecast for a couple with a partner called Will", () => {
    for (const text of [
      "You two will break up.",
      "Your marriage will fail.",
      "He will most likely cheat.",
    ]) {
      expect(findPolicyViolations(text, will).length, text).toBeGreaterThan(0);
      expect(findPolicyViolations(text, will)).toEqual(
        findPolicyViolations(text),
      );
    }
  });

  it("still reads the person called Will", () => {
    for (const text of [
      "Will will cheat on you.",
      "Will is a narcissist.",
      "You should leave Will.",
      "I recommend leaving Will.",
    ])
      expect(findPolicyViolations(text, will).length, text).toBeGreaterThan(0);
  });

  it("does not make a modal at the start of a question into the person", () => {
    // Pinned: "Will you two break up?" is a question that uses the modal. It is
    // not a finding for the block tier, with the names or without them.
    expect(findPolicyViolations("Will you two break up?", will)).toEqual([]);
    expect(findPolicyViolations("Will you stay for dinner?", will)).toEqual([]);
    expect(findPolicyFlags("Will you stay for dinner?", will)).toEqual([]);
  });

  it("matches the name as written or in capitals, never in another case", () => {
    expect(
      findPolicyViolations("YOU SHOULD LEAVE SAM.", { names: ["Sam"] }),
    ).not.toEqual([]);
    expect(
      findPolicyViolations("You should leave sam.", { names: ["Sam"] }),
    ).toEqual([]);
    expect(findPolicyViolations("You should leave will.", will)).toEqual([]);
    // A name given in lower case is also found capitalised.
    expect(
      findPolicyViolations("You should leave Sam.", { names: ["sam"] }),
    ).not.toEqual([]);
  });

  it("works for the other common words that are names", () => {
    const hope = { names: ["May", "Hope", "Grace", "Rose"] };
    expect(findPolicyViolations("Hope will cheat.", hope)).not.toEqual([]);
    expect(findPolicyViolations("You should marry Grace.", hope)).not.toEqual(
      [],
    );
    expect(findPolicyViolations("Rose is bipolar.", hope)).not.toEqual([]);
    expect(findPolicyViolations("May I ask what you need?", hope)).toEqual([]);
    expect(
      findPolicyViolations("Hope you two find time to talk.", hope),
    ).toEqual([]);
    expect(findPolicyViolations("Have faith in each other.", hope)).toEqual([]);
  });
});

describe("what a finding reports", () => {
  it("shows the name as written, never the token the engine used", () => {
    const names = { names: ["Sam", "Priya", "\u00c9lodie"] };
    for (const text of [
      "You need to leave Sam.",
      "Priya has ADHD.",
      "\u00c9lodie will cheat.",
      "Sam's going to cheat.",
    ]) {
      const found = findPolicyViolations(text, names);
      expect(found.length, text).toBeGreaterThan(0);
      for (const v of found) {
        expect(v.text).not.toMatch(/zzp/);
        expect(text).toContain(v.text);
      }
    }
    expect(findPolicyViolations("You need to leave Sam.", names)[0].text).toBe(
      "You need to leave Sam",
    );
    for (const v of findPolicyFlags("Sam is depressed.", names))
      expect(v.text).not.toMatch(/zzp/);
  });

  it("reads a contracted name, and not a possessive", () => {
    const names = { names: ["Sam"] };
    expect(findPolicyViolations("Sam's going to cheat.", names)).not.toEqual(
      [],
    );
    expect(
      findPolicyViolations("Sam\u2019s going to cheat.", names),
    ).not.toEqual([]);
    expect(findPolicyViolations("Sam's a narcissist.", names)).not.toEqual([]);
    expect(findPolicyViolations("Sam's keys are on the table.", names)).toEqual(
      [],
    );
  });
});

// Ruling 2026-10-19: a name that is a month, a season, a planet, the Sun or the
// Moon is the calendar word or the planet when a calendar or celestial
// predicate follows it (end soon, be over, arrive, start, come, finish, rise,
// set, go retrograde ...), and the person for any other predicate.
describe("names that are months, seasons or planets", () => {
  const as = (name: string, text: string) =>
    findPolicyViolations(text, { names: [name, "Sam"] });

  it.each([
    ["Summer", "Summer will end soon, so plan one more beach day."],
    ["Summer", "Summer will be over before you know it."],
    ["Summer", "Summer is over, and the evenings are shorter."],
    ["Summer", "Summer will arrive early this year."],
    ["Summer", "Summer starts next week."],
    ["Autumn", "Autumn will end soon, and winter will follow."],
    ["Winter", "Winter will come to an end in March."],
    ["June", "June will finish with a full moon."],
    ["April", "April will come soon."],
    ["May", "May will end soon."],
    ["Mercury", "Mercury will go retrograde next week."],
    ["Mercury", "Mercury turns direct on the 20th."],
    ["Venus", "Venus will set soon after the Sun."],
    ["Mars", "Mars will rise before dawn."],
    ["Saturn", "Saturn stations retrograde in June."],
  ])("reads %s as the calendar word or the planet in %j", (name, text) => {
    expect(as(name, text)).toEqual([]);
  });

  it.each([
    ["Summer", "Summer will cheat on you."],
    ["Summer", "Summer will leave you."],
    ["Summer", "Summer will end badly."],
    ["Summer", "Summer will end in divorce."],
    ["Summer", "Summer is a narcissist."],
    ["Summer", "Summer will definitely leave you."],
    ["Autumn", "Autumn will cheat."],
    ["June", "June will leave you."],
    ["April", "April is bipolar."],
    ["Mercury", "Mercury will leave you."],
    ["Venus", "Venus will cheat on you."],
    ["Summer", "You should leave Summer."],
  ])("reads %s as the person in %j", (name, text) => {
    expect(as(name, text).length).toBeGreaterThan(0);
  });

  it("still needs the capital letter, and names the calendar word nowhere else", () => {
    // A lower-case "summer" is never a name; with no name given nothing changes.
    expect(findPolicyViolations("summer will cheat on you.")).toEqual([]);
    expect(
      findPolicyViolations("Summer will cheat on you.", { names: ["Sam"] }),
    ).toEqual([]);
  });
});
