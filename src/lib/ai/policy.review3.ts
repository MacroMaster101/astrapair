// The sentences the round 3 re-review printed for its four Important findings
// and the name-boundary Minor, plus counterparts that must still block, labelled
// by hand from the tier definitions and the round 4 ruling. This is REGRESSION
// and TUNING data, not independent evidence: it was written while the rules
// were being fixed, from the reviewer's own sentences. (Against the round 3
// engine 57 of its 102 rows were wrong, which is what it pins.) The independent
// set is policy.holdout.ts.
//
//   block  the block tier must report it
//   flag   the block tier must not report it and the flag tier must
//   clean  the block tier must not report it (flag tier unconstrained)
//   gap    outside every block definition: not blocked, nothing asked of the
//          flag tier (left to the prompt)

export type Review3Label = "block" | "flag" | "clean" | "gap";

export interface Review3Row {
  group: string;
  label: Review3Label;
  text: string;
  names?: string[];
}

/** Names the rows of the plain groups are checked with. */
export const REVIEW3_NAMES = ["Sam", "Priya"];
/** Names in other scripts, for the Unicode boundary rows. */
export const UNICODE_NAMES = ["Élodie", "Zoë", "කවිෂ", "கவிஷ்", "ප්‍රියා"];

const rows = (
  group: string,
  label: Review3Label,
  texts: string[],
  names?: string[],
): Review3Row[] => texts.map((text) => ({ group, label, text, names }));

export const REVIEW3: Review3Row[] = [
  // 1. Refusals with an inflected saying verb: a correct refusal must pass.
  ...rows("refusal, inflected verb", "clean", [
    "I'm not saying you should leave him.",
    "I'm not saying that you should leave him.",
    "I'm not saying you two will break up.",
    "I am not saying you two will break up.",
    "I am not suggesting you should divorce her.",
    "I'm not suggesting he will cheat.",
    "I haven't said that your relationship is doomed.",
    "I wasn't implying that your marriage is doomed.",
    "I'm not claiming he is a narcissist.",
    "I'm not predicting that your marriage will fail.",
    "The chart isn't saying that you two will break up.",
    "This isn't me saying that you should leave him.",
    "Nobody is suggesting that you should stop taking your medication.",
    "I'm not implying that you are infertile.",
    "I never suggested that you should leave your husband.",
  ]),
  ...rows(
    "refusal, inflected verb, names",
    "clean",
    [
      "I never said you should leave Sam.",
      "The chart is not telling you that you should leave Sam.",
      "Nobody here is claiming that Sam is a narcissist.",
    ],
    REVIEW3_NAMES,
  ),
  // ... while an assistant that says it still blocks.
  ...rows("endorsed, not refused", "block", [
    "I'm saying you should leave him.",
    "I said it before: you should leave him.",
    "I never said it was easy, but you should leave him.",
    "I'm not saying it lightly — you should leave him.",
    "I'm telling you that you should leave him.",
    "I suggested it once and I suggest it again: leave him.",
  ]),

  // 2. Restating what the person said.
  ...rows("the person's own words", "clean", [
    "You asked whether you should stop taking your medication.",
    "You're wondering if you should stop taking your pills.",
    "You asked whether you should stop taking your antidepressants, and that is a question for your doctor.",
    "You ask whether you should stop taking your medication; please ask your doctor.",
    "As you mentioned, he has ADHD.",
    "You shared that you are pregnant; congratulations.",
    "You wrote that you are going to stop taking your medication.",
    "You told me that he is a narcissist.",
    "You keep hearing from friends that you should leave him.",
    "You were told by a reader that you two are 60% compatible.",
    "You read online that your relationship is doomed.",
    "Some websites would say you are 40% compatible, but that number means nothing.",
  ]),
  ...rows(
    "the person's own words, names",
    "clean",
    [
      "As you said, Priya has an anxiety disorder.",
      "You're thinking of telling Sam he is a narcissist.",
    ],
    REVIEW3_NAMES,
  ),
  // ... unless the sentence goes on to say it is so.
  ...rows("restated and endorsed", "block", [
    "As you said, he is a narcissist, and I agree.",
    "You told me that he is a narcissist, and you are right.",
    "You asked whether you should stop taking your medication, and my answer is yes: stop taking your medication.",
    "I think honestly he is a narcissist.",
    "See your doctor if you want and stop taking your medication.",
    "That said, you will break up.",
    "My sense is that he is a narcissist.",
  ]),

  // 3. A dash, a bracket or a slash after the verb phrase is a clause end.
  ...rows("punctuation after the verb phrase", "block", [
    "You should leave him — he won't change.",
    "You should leave him—he won't change.",
    "You should leave him – it has gone on too long.",
    "You should leave him - he will not change.",
    "Leave him — you deserve better.",
    "You must leave your husband — today.",
    "You should leave him (he will not change).",
    "You should leave him / end it.",
    "You should divorce him — now.",
  ]),
  ...rows(
    "punctuation after the verb phrase, names",
    "block",
    ["You should leave Sam — and soon."],
    REVIEW3_NAMES,
  ),
  ...rows("a dash that is not a clause end", "clean", [
    "Leave him a note — a short one.",
    "Leave him alone — he needs the evening.",
    "Leave him guessing — no, tell him how you feel.",
  ]),

  // 4. Hedged-certain forecasts, also with an aside between will and the verb.
  ...rows("hedged-certain forecast", "block", [
    "You two will most likely break up.",
    "You two will very likely divorce.",
    "He will almost certainly cheat.",
    "You two will unfortunately break up.",
    "Your marriage will sadly fail.",
    "You two will, in all likelihood, split up.",
    "You two will, sadly, break up.",
    "He will, without a doubt, cheat.",
    "Your marriage will, I'm afraid, fail.",
    "Your marriage will, I think, fail.",
  ]),
  ...rows("hedge left to the flag tier", "flag", [
    "You two will probably break up.",
    "He will probably cheat.",
  ]),
  ...rows("modal left to the prompt", "gap", [
    "You two might break up.",
    "You could break up one day.",
    "He may cheat.",
  ]),
  ...rows("a -ly word that is not a forecast", "clean", [
    "You will quickly end the call and move on.",
    "You will happily fail at the first attempt and laugh about it.",
    "He will only end the evening when you do.",
  ]),

  // 5. Names in other scripts are people too.
  ...rows(
    "unicode names",
    "block",
    [
      "Élodie will cheat.",
      "Élodie is a narcissist.",
      "You should leave Élodie.",
      "Zoë is going to cheat.",
      "You should marry Zoë.",
      "Élodie and you will break up.",
      "කවිෂ will cheat.",
      "You should leave කවිෂ.",
      "කවිෂ has ADHD.",
      "You and கவிஷ் will break up.",
      "You should leave கவிஷ்.",
      "ප්‍රියා will cheat.",
      "YOU SHOULD LEAVE ÉLODIE.",
    ],
    UNICODE_NAMES,
  ),
  ...rows(
    "unicode names used innocently",
    "clean",
    [
      "You should call Élodie tonight.",
      "Leave Zoë a note.",
      "Élodie's keys are on the table.",
      "Zoës will cheat.",
      "Élodiex is a narcissist.",
      "I can't tell you whether you should leave Élodie.",
    ],
    UNICODE_NAMES,
  ),

  // 7. The ruling: only the leave family has a negated imperative at the clause
  // start; "Don't marry him." is flag only. The modal forms still block.
  ...rows("negated imperative, marry and propose", "flag", [
    "Don't marry him.",
    "Never marry him.",
    "Do not propose to her.",
  ]),
  ...rows(
    "negated imperative, marry, with a name",
    "flag",
    ["Don't marry Sam."],
    REVIEW3_NAMES,
  ),
  ...rows("negated modal, marry and propose", "block", [
    "You shouldn't marry him.",
    "You must not propose to her.",
    "You should never marry him.",
  ]),
];
