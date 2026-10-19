export type PolicyCategory =
  | "directive"
  | "prediction"
  | "score"
  | "diagnosis"
  | "reproductive"
  | "medication"
  | "financial";

export interface PolicyViolation {
  category: PolicyCategory;
  /** The offending words, whitespace collapsed. Never log this. */
  text: string;
}

/** Added to the retry after an answer that broke the policy. */
export const POLICY_RETRY_INSTRUCTION =
  "Your previous answer contained advice or predictions that astrology cannot support. Answer again without telling the person what to do, predicting outcomes, scoring, or diagnosing; offer reflective questions instead.";

// ---------------------------------------------------------------------------
// Policy filter: runs on the model's answer after it is written, so the rules
// hold even when the prompt is ignored. Pure, and table-driven in policy.test.
//
// Two tiers share one engine:
//   BLOCK  findPolicyViolations  a small, high-precision core (see "BLOCK tier"
//          below). The only tier the services act on: a retry, then a fallback.
//   FLAG   findPolicyFlags       the broader rules of the first round. Never
//          blocks. Read in the live eval transcript and kept for monitoring.
// Which sentence belongs to which tier is pinned, table by table, in
// policy.test.ts.
//
// Design
//   1. Text is cut into sentences, and each sentence into clauses at contrast
//      and continuation words (but, however, though, yet, so), dashes and
//      colons. A trigger is always found anywhere in the sentence, so splitting
//      can never hide one; the clause only decides what may excuse it.
//   2. Directives. The flag tier reads a broad list of actions (stay, forgive,
//      move in ...), as a modal, an advice frame or a clause-initial imperative.
//      The block tier reads the leave family (leave him, break up, split up,
//      divorce, end the relationship, dump him) and marry / propose. A NEGATED
//      leave-family directive ("you shouldn't leave him", "Don't leave her.") is
//      advice to stay, common in reassurance, so it is flag tier only; a
//      negated marry or propose ("you shouldn't marry him") still blocks as a
//      modal. By the round 3 ruling the clause-initial imperative covers the
//      leave family only, so "Don't marry him." is flag tier only too.
//   3. An excuse needs scope. A limitation or "not claiming" cue ("I can't tell
//      you", "I'm not saying", "nothing here says", "does not mean", "no
//      evidence that") excuses a trigger only when plain words link the cue to
//      it in the same clause. A negator in a coordinated or conditional sibling
//      never excuses ("He doesn't love you and he will cheat."). Doubt ("whether
//      you should") and a saying verb whose speaker is the person or someone
//      around them ("you asked whether", "as you mentioned,") excuse the claim
//      they hand back, unless the sentence goes on to endorse it; the
//      assistant's own saying verb ("I think") never does, and a generic
//      third party ("astrologers say") only if the sentence then rejects it.
//   4. Predictions, scores, diagnoses, reproductive and medication claims whose
//      own verb is negated ("is not doomed", "will not survive the year") are
//      simply not in the patterns; a negated score ("not 85%") passes.
//   5. Text inside quotation marks counts like any other text, and is excused
//      only when the same sentence also holds a limitation about it.
//   6. A question that holds a trigger, answered at once with a plain yes
//      ("Should you leave him? Yes."), is read as the statement it answers
//      (flag tier).
//   7. Names. A name the caller supplies is replaced in the text by one fixed
//      word before scanning, with a small Unicode expression (letters, marks and
//      digits continue a name), so one engine serves every couple and names in
//      any script work. Words like "you" or "partner" are never names. A name
//      that is also a month, a season or a planet ("Summer", "June", "Mercury")
//      is the calendar word or the planet when a calendar or celestial predicate
//      follows it ("Summer will end soon.", "Mercury will go retrograde."), and
//      the person for any other predicate ("Summer will leave you.").
//   8. The person's own quoted words after "You asked," / "You wrote," / "You
//      said," are handed back, not advice, unless the assistant adopts them.
//
// Every pattern in both tiers is linear time on purpose: bounded quantifiers
// only, no nested optional groups, whitespace collapsed to single spaces, the
// per-match work bounded by a window, and no lazy group that can backtrack over
// a long run of one character, so 40,000 characters stay fast (policy.test.ts
// times both functions on 60 repeated inputs, including the slow ones found in
// review).
//
// Left to the prompt and the live eval (see policy.test.ts "deliberately not
// caught"): idioms and oblique forecasts, bare one-word answers without a
// question, and softly hedged options such as "you could leave him".
// ---------------------------------------------------------------------------

/**
 * A person's name the caller supplies (the two display names in a prompt) is
 * woven into the patterns at the places where "him", "her" or "your partner"
 * stand. Sources hold this slot; an engine fills it with the names (or with an
 * alternative that never matches).
 */
const NAME_SLOT = "\u0001";
/**
 * Supplied names are not woven into the patterns. They are replaced in the
 * normalised text by this one fixed word, which the patterns know, so one engine
 * serves every couple and a name in any script matches (see nameReplacer).
 */
const NAME_PATTERN = "zzp\\d{1,2}zz";
/** The word a supplied name becomes: its index among the names found in the text. */
const nameToken = (index: number) => `zzp${index}zz`;
const TOKEN_IN_TEXT = /zzp(\d{1,2})zz/g;

const alt = (parts: string[]) => `(?:${parts.join("|")})`;
/** Up to two of these words, each followed by a space. */
const adverbs = (words: string[]) => `(?:${alt(words)} ){0,2}`;

// Who is addressed, and who a verdict is about.
const YOU = "(?:you|you both|you two|both of you|the two of you)";
const PARTNER =
  "(?:partner|husband|wife|boyfriend|girlfriend|fianc\\w+|spouse|ex)";
const PERSON = `(?:him|her(?! (?:own|instincts?|words|feelings?|needs|side|point|space|time|family|friends|work|job|career|life|mother|father|mom|dad|sister|brother)\\b)|them|your ${PARTNER}|(?:the|this|that) (?:man|woman|person|guy)|${NAME_SLOT})\\b`;
const THEM = `(?:${PERSON}|(?:the|this|your|that|our) (?:relationship|marriage|engagement|partnership)\\b)`;
// The end of a clause, so "leave" is the verb and not "leave room".
const END =
  "(?=\\s*(?:$|[.,!?;:)\\u2014\\u2013(\\[/]|--|-(?=\\s))|\\s+(?:now|today|immediately|soon|right away|asap|already|for good|tonight|tomorrow|this (?:week|month|year|summer|spring|autumn|winter)|next (?:week|month|year))\\b)";

const SAY_ADV = adverbs([
  "really",
  "definitely",
  "absolutely",
  "probably",
  "certainly",
  "honestly",
  "simply",
  "just",
  "seriously",
  "both",
  "then",
  "now",
  "finally",
  "truly",
  "strongly",
  "maybe",
  "perhaps",
  "also",
  "still",
  "likely",
]);

const NUM_WORD =
  "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
const SPELLED_PCT =
  "(?:(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|ten|five|one hundred|a hundred|hundred)";
const PCT = `(?:\\d{1,3}(?:\\.\\d{1,2})? ?(?:%|percent|per ?cent)|${SPELLED_PCT} (?:percent|per ?cent))`;

// 1. Directive ---------------------------------------------------------------

/** A relationship action, in the base form after "should" or an imperative. */
const ACTION = alt([
  "break ?up(?! (?:the|a|an|into|any|big|large|long|this|that|these|those|your (?:task|day|week|work|routine))\\b)",
  "split up(?! (?:the|a|an|into|any|chores|tasks|costs|bills|work|duties|your|this|that|these|those)\\b)",
  "divorce(?! (?:is|was|are|can|will|law\\w*|attorney|papers|rates?|settlement|proceedings|court|has|may|might|could|would)\\b)",
  "get (?:a )?divorce[d]?",
  "get married",
  "get engaged",
  `marry(?: ${THEM}|${END})`,
  `propose(?: to ${THEM}| marriage|${END})`,
  "end (?:the|your|this|that|our) (?:relationship|marriage|engagement|partnership|romance)",
  "end things",
  `end it(?: with ${THEM}|${END})`,
  `leave(?: ${THEM}(?! (?:alone|be\\b|a\\b|an\\b|some|the\\b|room|space|with\\b|his\\b|her\\b))|${END})`,
  `separate(?: from ${THEM}|${END})`,
  `walk away(?: from ${THEM}|${END})`,
  `stay with ${THEM}`,
  "stay in (?:this|the|your|that|our) (?:relationship|marriage)",
  "get out of (?:this|the|your|that|our) (?:relationship|marriage)",
  `get out${END}`,
  `end (?:this|that)${END}`,
  "stay together",
  "stay married",
  `stay${END}`,
  `get back together(?: with ${THEM}|${END})`,
  `move in(?: together| with\\b|${END})`,
  `move on(?: from ${THEM}|${END})`,
  "call it quits",
  "part ways",
  `dump ${PERSON}`,
  `let ${PERSON} go`,
  `cut ${PERSON} off`,
  `cut ties with ${THEM}`,
  `take ${PERSON} back`,
  `forgive ${PERSON}`,
  `trust ${PERSON}`,
  `give ${THEM} (?:another|a second|one more|a last|a final) chance`,
  `give up on ${THEM}`,
  `go back to ${PERSON}`,
  "have (?:a |another )?(?:baby(?!-)|child(?:ren)?(?![-'\\w])|kids?)",
  "try for a baby",
  "get pregnant",
  "start a family",
]);
const GERUND = alt([
  `leaving(?: ${THEM}|${END})`,
  "breaking up",
  "splitting up",
  "divorcing",
  "ending (?:it|things|the relationship|this relationship|your relationship|the marriage)",
  `marrying(?: ${THEM}|${END})`,
  "getting (?:married|divorced|engaged)",
  "staying together",
  `staying with ${THEM}`,
  `moving in(?: together|${END})`,
  `moving on(?: from ${THEM}|${END})`,
  `walking away(?: from ${THEM}|${END})`,
  "parting ways",
  "calling it quits",
  "having (?:a )?(?:baby|child(?:ren)?(?![-'\\w])|kids?)",
]);
const MODAL = alt([
  "should(?:n't| not)?",
  "must(?:n't| not)?",
  "ought(?: not)? to",
  "oughtn't to",
  "need to",
  "have to",
  "have got to",
  "got to",
  "gotta",
  "had better(?: not)?",
  "better(?: not)?",
  "will need to",
  "will have to",
  "are going to have to",
  "are going to need to",
]);
const MODAL_CONTRACTED =
  "'(?:ve got to|ll need to|ll have to|d better(?: not)?)";

const FRAME_ADV =
  "(?:(?:probably|perhaps|maybe|really|honestly|just|simply|also) ){0,2}";
const FRAME_TAIL =
  "(?: for you(?: both| two)?)?(?: that)?(?: (?:you(?: both| two)?|the two of you)(?: should)?)?(?: to)?";
const GOOD_THING =
  "(?:best|better|wise|wisest|smart|smartest|sensible|advisable|right|time|high time|a good idea|for the best|the (?:best|right|wise|smart|healthiest|safest|kindest) (?:thing|choice|move|decision|option|call|idea|course|step))";

const DIRECTIVE = [
  `\\b${YOU}(?: ${SAY_ADV}${MODAL}|${MODAL_CONTRACTED}) ${SAY_ADV}(?:(?:not|never) )?${ACTION}`,
  // "Consider" and "think about" soften the verb, not the instruction.
  `\\b${YOU} ${SAY_ADV}(?:should|must|could|might|may|can|ought to|need to|have to)(?: (?:really |also )?(?:want|wish) to)? ${SAY_ADV}(?:consider|think about|look at|weigh up) ${GERUND}`,
  `\\b${YOU} ${SAY_ADV}(?:might|may|could|would) (?:also |really )?(?:want|wish|like) to ${SAY_ADV}${ACTION}`,
  // "I advise / I'd say / I recommend ..."
  `\\bi(?:'d| would|'ll| will)?(?: (?:strongly|really|definitely|honestly|personally|highly|gently|kindly|would)){0,2} (?:advise|recommend|suggest|urge|encourage|insist|say|counsel|propose|tell you)(?: that)? (?:you(?: both| two)? )?(?:to )?(?:both )?(?:${ACTION}|${GERUND})`,
  `\\b(?:if i were you|in your (?:shoes|position|place)),? i(?:'d| would) (?:probably |definitely |really |just |personally )*(?:${ACTION}|${GERUND})`,
  `\\bi(?:'d| would| wouldn't| would not) (?:probably |definitely |really |just |personally |honestly |certainly )*${ACTION}`,
  // "It might be best to", "it's time to", "it would be wise to"
  `\\b(?:it|that)(?:'s| is| would be| might be| may be| could be| will be| 'd be| was) ${FRAME_ADV}${GOOD_THING}${FRAME_TAIL} ${SAY_ADV}${ACTION}`,
  // "The best thing you can do is walk away", "my advice is to ..."
  `\\b(?:the |my )?(?:best|right|wise|wisest|smart|smartest|safest|healthiest|kindest|only) (?:thing|choice|move|decision|option|idea|course|step|answer)(?: for you(?: both| two)?)?(?: you can do| to do| here| now| you could do)? (?:is|would be|might be|may be|will be|seems to be)(?: to| that you(?: both| two)?(?: should)?)? ${SAY_ADV}${ACTION}`,
  `\\bmy (?:advice|suggestion|recommendation|honest (?:advice|opinion|view|suggestion)|opinion|view|counsel|take|guess)(?: for you)?(?: is| would be)?(?: to| that you(?: both| two)?(?: should)?)? ${SAY_ADV}${ACTION}`,
  // "You would be wise to ...", "you're better off without her"
  `\\b${YOU}(?:'d| would| might| may| could|'ll| will)? (?:be )?(?:wise|smart|sensible|well advised|best advised|better advised|do well) to ${SAY_ADV}${ACTION}`,
  `\\b${YOU}(?:'re| are|'d be| would be| will be| might be| may be) (?:better off|happier|safer|healthier|calmer) (?:without|apart|splitting|breaking|ending|leaving|separating|divorcing|single|alone|parting|going your separate ways|if you (?:left|split|broke|ended|divorced|separated))`,
  `\\bbetter off without (?:him|her|them|each other|your ${PARTNER})\\b`,
  // "Breaking up is the right choice for you."
  `\\b(?:${GERUND}|leaving|moving on|walking away) (?:is|would be|might be|may be|could be|will be|seems|sounds|'s) ${FRAME_ADV}(?:the |a |your |an )?(?:best|right|wise|smart|healthiest|safest|sensible|better|correct|kindest)\\b`,
];

/** Clause-initial imperatives: "Leave him.", "Don't marry him.", "Just break up with her." */
const FILLER =
  "(?:(?:please|just|honestly|really|yes|no|so|well|and|then|now|first|simply|actually|frankly|truly|do|go ahead and|go on and|why not)[, ]+){0,3}";
const NEG = "(?:(?:do not|don't|never|never ever|do not ever|don't ever) )?";
const DIRECTIVE_STARTING = [`${FILLER}${NEG}${ACTION}`];

// 2. Prediction --------------------------------------------------------------

const ABOUT_THEM = alt([
  YOU,
  "he",
  "she",
  "they",
  `your ${PARTNER}`,
  NAME_SLOT,
  "(?:your|this|the) (?:relationship|marriage|union|romance|bond|partnership|engagement|couple|pairing|match)",
]);
const ABOUT_RELATIONSHIP =
  "(?:(?:your|this|the) (?:relationship|marriage|union|romance|bond|partnership|engagement|pairing|match|couple)|you two|the two of you|things between you)";
const GOING = "(?:going to|gonna|destined to|bound to|doomed to|fated to)";
const WILL = alt([
  "'ll",
  " will",
  ` (?:is|are) (?:${GOING}|certain to|sure to|likely to)`,
  `'(?:s|re) ${GOING}`,
]);
const FORECAST_ADV = adverbs([
  "definitely",
  "certainly",
  "surely",
  "inevitably",
  "absolutely",
  "undoubtedly",
  "eventually",
  "likely",
  "probably",
  "soon",
  "ultimately",
  "one day",
  "someday",
]);
const OUTCOME = alt([
  "break ?up(?! (?:the|a|an|into|any|big|large|long)\\b)",
  "split up",
  `separate${END}`,
  "divorce\\b",
  "get (?:married|divorced|engaged)",
  `marry(?: ${THEM}| each other|${END})`,
  `propose(?: to ${PERSON}| marriage|${END})`,
  "cheat\\b",
  "fail\\b(?! to\\b)",
  "last (?:forever|a lifetime|for life)",
  "stay together",
  "be (?:married|engaged|divorced|parents|husband and wife)\\b(?! to\\b)",
  "be together (?:forever|for life|always)",
  `come back to (?:you|him|her|each other)`,
  "have (?:a |two |three |\\d+ )?(?:babies|baby(?!-)|child(?:ren)?(?![-'\\w])|kids?)",
  "end up (?:divorced|separated|alone|apart|broken up|splitting up|breaking up|cheating|unhappy|miserable|married)\\b",
  "end up together(?! (?:at|in|on|around|during|over)\\b)",
  "become (?:parents|husband and wife)",
  "leave (?:you|him|her|each other)",
]);
const RELATIONSHIP_OUTCOME = alt([
  "end\\b",
  "fall apart",
  "collapse",
  "crumble",
  "not last",
  "be over",
  "never work",
  "not work out",
  "last\\b(?! (?:only|as long|for as long|just as long|longer|through|if|when|while|until|a (?:while|bit|few|moment)|beyond))",
  "survive",
]);
const INTENSIFIER =
  "(?:(?:already|truly|really|just|simply|clearly|probably|likely|absolutely|completely|totally|utterly|surely|certainly|sadly|obviously|basically) ){0,2}";
const DOOMED = alt([
  "doomed",
  "destined to fail",
  "cursed",
  "hopeless",
  "bound to fail",
  "going nowhere",
  "not going to (?:last|work)",
  `meant to be${END}`,
  "written in the stars",
  "fated",
  "a (?:lost cause|failure)",
]);

const PREDICTION = [
  `\\b${ABOUT_THEM}${WILL} ${FORECAST_ADV}${OUTCOME}`,
  `\\b${ABOUT_RELATIONSHIP}${WILL} ${FORECAST_ADV}${RELATIONSHIP_OUTCOME}`,
  `\\b(?:this|your|the|that|our) (?:relationship|marriage|union|match|romance|partnership|love|engagement|pairing) (?:is|are|looks|seems|appears|will be|was|feels) ${INTENSIFIER}${DOOMED}`,
  `\\b${alt([ABOUT_RELATIONSHIP, "he", "she", "they"])} (?:won't|will not|will never|isn't going to|aren't going to) (?:last|survive|make it|work out)`,
  `\\b(?:this|it|that) (?:won't|will not|isn't going to) (?:last|work out|survive)${END}`,
  `\\b${YOU}(?:'ll| will) (?:definitely|certainly|surely|absolutely|undoubtedly|inevitably)\\b`,
  `\\b${YOU} (?:are|were) (?:meant|destined|fated) to (?:be together|be with|spend|stay together)`,
  "\\band (?:will|'ll) (?:always |definitely |certainly )?(?:be|stay) together (?:forever|for life|always)",
  "\\b(?:only|just) a matter of time (?:before|until) (?:you|he|she|they|it|things|the relationship|this|your)\\b",
  "\\b(?:relationship|marriage|union|romance|pairing|match|bond|partnership) has no (?:future|chance|hope)\\b",
  `\\b${ABOUT_THEM} ?(?:is|are|'s|'re) never (?:going to|gonna) (?:change|stop|improve|commit|learn|love|grow up|be faithful)`,
  "\\bguarantee[sd]? to\\b",
];

// 3. Score -------------------------------------------------------------------

const SCORE = [
  `\\b${PCT} (?:compatible|compatibility|match(?:ed)?|chance|likely|probability|odds|certain|sure|success|harmony|harmonious|aligned|of (?:success|compatibility|a match))`,
  "\\b(?:compatibility|match|harmony|relationship|love|overall|astrological) (?:score|rating|percentage|index|grade)\\b",
  // Not a date ("on 7/10 at noon") or a statistic ("3 out of 10 couples").
  "(?<![\\d/.])(?<!\\b(?:on|by|until|from|since|before|after|due) )\\b\\d{1,2}(?:\\.\\d)? ?(?:/|out of) ?10\\b(?![/\\d]|\\.\\d)(?! (?:couples|people|times|pairs|cases|partners|relationships|degrees?|points?|houses|aspects|charts|planets|signs|at|on|of (?:them|us|the)))",
  "(?<![\\d/.])\\b\\d{1,3} ?(?:/|out of) ?100\\b(?![/\\d]|\\.\\d)(?! (?:couples|people|times|pairs|cases|partners|relationships|degrees?|points?|percent))",
  `\\b${NUM_WORD} out of (?:ten|a hundred|one hundred)\\b(?! (?:couples|people|times|pairs|cases|partners|relationships|of (?:them|us|the)))`,
  `\\b(?:\\d|${NUM_WORD}) stars? out of (?:5|five|10|ten)\\b`,
  "\\b(?:high|low) (?:probability|likelihood)\\b",
  "\\bprobability of (?:success|break ?up|divorce|compatibility|lasting)\\b",
  // "Your compatibility is 85%." / "compatibility: 78/100" (see readColons)
  `\\b(?:compatib\\w*|match(?:ed)?|scores?|rating|rated|harmony|chemistry|odds|likelihood|probability|rank(?:s|ed|ing)?|grade) (?:is|are|stands at|comes (?:out )?(?:at|to)|came out at|=|at|of)? ?(?:about |around |roughly |approximately |nearly |almost |just )?(?:${PCT}|\\d{1,3} ?/ ?(?:10|100)\\b|\\d{1,3} out of (?:10|100)\\b)`,
  // "I'd give you two a 9."
  `\\bi(?:'d| would|'ll| will)? (?:give|rate|score|rank|grade) (?:you|your|this|it|that|the|these)\\b[^.?!]{0,25}?\\b(?:an?|at|as|about|around) (?:\\d{1,2}(?:\\.\\d)?|${NUM_WORD})\\b(?! (?:minutes|hours|days|weeks|months|years|times|more|degrees))`,
  `\\bscale of (?:1|one|0|zero) (?:to|-|through) (?:10|ten|100|5|five),? (?:you|your|this|that|it|the|we|i)\\b`,
  // "around ninety percent." at the end of a clause
  `\\b(?:around|about|roughly|approximately|nearly|almost) ${PCT}(?! of\\b)(?=\\s*(?:$|[.,!?;:]|compatible|match))`,
  `\\b(?:it's|that's|that is|it is|you're|you are|you two are|we're|comes? (?:out )?(?:at|to)|stands? at|sits? at) (?:about |around |roughly |approximately |nearly |almost )?${PCT}(?! of\\b)`,
];
/** A whole clause that is only a number: "About 80 percent.", "Eight out of ten." */
const SCORE_STARTING = [
  `(?:(?:about|around|roughly|approximately|nearly|almost|maybe|probably|say|i'd say|i would say|it's|it is|that's|that is|you're|you are|you two are|we're|a|an|at) ){0,4}(?:${PCT}|\\d{1,2} ?(?:/|out of) ?10\\b|\\d{1,3} ?(?:/|out of) ?100\\b|${NUM_WORD} out of (?:ten|a hundred))(?: or so| compatible| match| overall| together)?(?:,? (?:i'd say|i would say|maybe|roughly))?[.!]?$`,
];
/** "A compatibility score is not something astrology offers" refuses; it does not score. */
const TRAILING_REFUSAL =
  /^[^.,;:]{0,40}?\b(?:(?:is|are|was|were|does|do) (?:not|n't) (?:something|a thing|part|what|how|offered|available|given|measurable|meaningful|real|possible|useful|helpful|exist|work|measure|offer|give|provide|deal)|isn't|aren't|doesn't|don't|(?:can|could)(?:not|n't) be (?:measured|calculated|scored|known)|(?:is|are) (?:just |only |merely )?(?:a )?(?:myths?|nonsense|meaningless|made up|invented|entertainment|games?|fun|gimmicks?))\b/i;
const SCORE_NOUN_ONLY = new Set([1]);

// 4. Diagnosis ---------------------------------------------------------------

const DX_SUBJECT = alt([
  "you",
  "he",
  "she",
  "they",
  `(?:your |the )?${PARTNER}`,
  "your (?:mother|father|mom|dad|mum)",
  NAME_SLOT,
]);
const DX_VERB = alt([
  "is",
  "are",
  "'s",
  "'re",
  "has",
  "have",
  "was",
  "were",
  "(?:seems?|appears?) to (?:be|have)",
  "(?:may|might|could|must) (?:be|have)",
  "suffers? from",
  "suffering from",
  "(?:shows?|showing|exhibits?) signs of",
  "(?:is|are) showing signs of",
]);
const DX_ADV = adverbs([
  "probably",
  "likely",
  "definitely",
  "clearly",
  "certainly",
  "obviously",
  "just",
  "really",
  "actually",
  "simply",
  "basically",
  "textbook",
  "possibly",
  "potentially",
  "also",
  "almost certainly",
]);
const DX_TERM = alt([
  "narcissis\\w*",
  "alcoholic",
  "psychopath\\w*",
  "sociopath\\w*",
  "bipolar",
  "depress(?:ion|ed|ive)\\b(?! (?:about|by|over|at|because|with)\\b)",
  "anxiety disorder",
  "adhd",
  "autis(?:m|tic)",
  "ptsd",
  "borderline personality",
  "bpd",
  "(?:\\w+ )?personality disorder",
  "schizophreni\\w+",
  "ocd",
  "eating disorder",
  "mental(?:ly)? (?:ill|illness|disorder)",
  "clinically \\w+",
]);
const DX_ARTICLE =
  "(?:(?:a|an|the|clear|severe|mild|classic|serious|real|undiagnosed|untreated) ){0,2}";
const DX_ABUSE = alt([
  "being (?:abused|gaslit|gaslighted|manipulated|controlled)",
  "in an? (?:\\w+ )?toxic relationship",
  "abusive",
  "(?:an? )?abuser",
  "in an? (?:\\w+ )?abusive relationship",
  "(?:emotionally|physically|verbally) abusive",
  "abusing you",
  "gaslighting you",
  "manipulating you",
]);

const DIAGNOSIS = [
  `\\b${DX_SUBJECT} ?${DX_ADV}${DX_VERB} ${DX_ADV}${DX_ARTICLE}${DX_TERM}`,
  `\\b(?:you|he|she|they|your ${PARTNER}) ?${DX_ADV}(?:is|are|'s|'re) ${DX_ADV}${DX_ABUSE}`,
  // "sounds like a narcissist", "looks like he has depression"
  `\\b(?:sounds?|looks?|seems?|appears?|reads?) (?:just |exactly |very much |a lot |a bit )?(?:like|as if|as though) (?:(?:he|she|they|you|your ${PARTNER})(?:'s| is| are| has| have)? )?${DX_ADV}${DX_ARTICLE}${DX_TERM}`,
  `\\b(?:sounds?|looks?|seems?) like (?:an? )?(?:[\\w-]+,? ){0,2}(?:abusive|toxic|controlling|coercive) (?:relationship|marriage|partner|man|woman|person)`,
  // "classic narcissism", "those are signs of borderline personality disorder"
  `\\b(?:classic|textbook)(?: case of)? ${DX_TERM}`,
  `\\b(?:those|these|they|that|this|it|here)(?:'s| is| are)? (?:all )?(?:classic |clear |textbook )?(?:signs|symptoms|traits|hallmarks) of ${DX_TERM}`,
  `\\b${DX_SUBJECT} ?${DX_ADV}(?:displays?|exhibits?|shows?|demonstrates?|has|have) (?:(?:clear|strong|classic|some|many|several|obvious) )?(?:narcissistic|psychopathic|sociopathic|bipolar|borderline|depressive|paranoid|manic|autistic) (?:traits|tendencies|features|symptoms|behaviou?rs?|personality)`,
  `\\b${DX_SUBJECT} ?${DX_ADV}${DX_VERB} (?:also )?(?:struggling|living|dealing|coping|battling|suffering) with (?:an? |some |possible |likely |undiagnosed |untreated )*${DX_TERM}`,
  // "That is abuse."
  "\\b(?:that|this|it)(?:'s| is| was) (?:\\w+ )?(?:abuse|abusive|domestic violence|coercive control)\\b",
  "\\bwhat you(?:'re| are|'ve| have)? describ\\w* (?:is|sounds like|amounts to) (?:an? )?(?:\\w+ )?(?:abuse|abusive|domestic violence)\\b",
];

// 5. Reproductive ------------------------------------------------------------

const REPRO_SUBJECT = "(?:you|she|your (?:partner|wife|girlfriend|fianc\\w+))";
const REPRODUCTIVE = [
  `\\b${REPRO_SUBJECT} ?(?:is|are|'s|'re|will be|'ll be|might be|may be|could be|must be|is going to be|are going to be) ${adverbs(["probably", "likely", "definitely", "already", "currently", "really"])}(?:pregnant|infertile|barren|expecting(?= ?(?:a baby|a child|twins|a boy|a girl|a little one|their first|her first|again|soon|in\\b|$|[.,!?;:])))`,
  `\\b(?:you|she|he|they|your (?:partner|wife|husband)) (?:can't|cannot|can not|won't|will not|will never|are unable to|is unable to|aren't able to|isn't able to) (?:be able to )?(?:conceive|have (?:a )?(?:children|child|baby|babies|kids?)|get pregnant)`,
  `\\b(?:you|she)(?:'ll| will| are going to| is going to| are about to) (?:soon )?(?:conceive(?! of\\b)|get pregnant|become (?:pregnant|parents)|be pregnant|have (?:twins|a (?:boy|girl|son|daughter)))`,
  `\\bfertility (?:problems?|issues?|troubles?|difficulties|struggles?) (?:are|is|will)\\b(?! (?:\\w+ ){0,2}?(?:sensitive|difficult|hard|common|complex|private|personal|emotional|painful))`,
  `\\b(?:you|she|he|your (?:partner|wife|husband)) (?:has|have) (?:fertility|conception) (?:problems?|issues?|difficulties)`,
  `\\b${YOU} ${SAY_ADV}${MODAL} ${SAY_ADV}(?:start |begin )?(?:trying|try) (?:to conceive|for a (?:baby|child|family)|to get pregnant)`,
  "\\b(?:now|this (?:year|month|season|spring|summer|autumn|fall|winter)|today) (?:is|would be|looks like|seems like|is looking like|could be) (?:a |the )?(?:good|great|perfect|right|best|ideal|wonderful|fine|favou?rable|lucky)(?: \\w+)? (?:time|moment|period|window|season) (?:for you(?: both| two)? )?to (?:try(?:ing)? for|have|start|conceive|get pregnant|try to (?:conceive|get pregnant))",
  "\\byou(?:'ll| will) (?:struggle|have (?:trouble|difficulty|problems)|find it (?:hard|difficult)) (?:to )?(?:conceive|conceiving|getting pregnant|have (?:a )?(?:baby|children|child|kids)|having (?:a )?(?:baby|children|child|kids))",
  "\\b(?:a |the )?pregnancy is (?:likely|probable|certain|expected|coming|on the way|due|indicated|imminent|in your future)",
  "\\b(?:you|she)(?:'re| are) (?:very |extremely |highly |especially |super |quite )?fertile\\b",
];

// 6. Medication --------------------------------------------------------------

// Named medicines that are not psychiatric: stopping or skipping them is as much
// a medical instruction as stopping an antidepressant.
const OTHER_MEDICINES =
  "metformin|warfarin|levothyroxine|statins?|atorvastatin|simvastatin|blood thinners?|metoprolol|amlodipine|lisinopril|prednisone|prednisolone|antibiotics?|chemo(?:therapy)?|inhalers?|epi-?pens?|painkillers?|ibuprofen|paracetamol|acetaminophen|aspirin";
const MED_NOUN = `(?:medications?|medicines?|meds|pills?|antidepressants?|prescriptions?|doses?|dosage|tablets|insulin|ssris?|antipsychotics?|birth control|contraceptives?|capsules|${OTHER_MEDICINES})`;
const MEDICATION = [
  `\\b(?:take|stop taking|stop using|stop|increase|reduce|lower|skip|quit|double|come off|cut back on|cut down on|go off|going off|get off|taper off|drop|ditch|abandon) (?:your|the|any|all|those|these|some|extra|a|an|one|two|each|every) (?:\\w+ )?${MED_NOUN}\\b`,
  `\\b(?:you |i )?(?:don't|do not|no longer|no more) need (?:(?:your|the|any) )?(?:\\w+ )?${MED_NOUN}\\b`,
  `\\b(?:better|safer|stronger|more effective) than (?:your|the) (?:\\w+ )?${MED_NOUN}\\b`,
  `\\b(?:take|use|have) (?:half|double|more|less|fewer|extra|a lower|a higher|a smaller|a bigger) (?:of )?(?:your |the |a |an )?(?:\\w+ )?${MED_NOUN}\\b`,
  "\\b(?:stop|stopping|quit|skip|come off|go off|get off) (?:using |taking )?(?:your |the )?(?:birth control|the pill|contraceptive pill)\\b",
];
const DOCTOR_BEFORE =
  /\b(?:ask|talk(?:ing)?|speak(?:ing)?|check(?:ing)?|consult\w*|discuss\w*|see|call|contact|confirm|run it by|advice from|guidance from|go to)\b[^.;,:]{0,40}?\b(?:doctor|pharmacist|physician|prescriber|gp|nurse|psychiatrist|clinician|healthcare (?:provider|professional)|health professional|medical (?:professional|provider|team))\b(?:(?!\band\b)[^.;,:]){0,30}$/i;
const PRESCRIBED_AFTER =
  /^[^.;,]{0,30}?\b(?:as (?:prescribed|directed|instructed)|(?:doctor|gp|pharmacist|physician|prescriber)(?:'s)? (?:has |have |had )?(?:prescribed|advised|recommended|told|said|instructed))\b/i;

// 7. Financial ---------------------------------------------------------------

const MONEY = alt([
  "stocks?",
  "shares",
  "crypto\\w*",
  "bitcoin",
  "gold",
  "propert(?:y|ies)",
  "real estate",
  "funds?",
  "bonds?",
  "money",
  "savings",
  "business",
  "market",
  "startup",
  "a (?:house|home|flat|apartment)",
]);
const ASSET =
  "(?:shares|stocks?|crypto\\w*|bitcoin|gold|silver|propert(?:y|ies)|real estate|house|home|car|land|business|bonds?|investments?|savings|flat|apartment|startup)\\b";
const FINANCIAL = [
  `\\b${YOU} ${SAY_ADV}${MODAL} ${SAY_ADV}(?:invest\\b[^.]{0,40}?\\b${MONEY}|(?:borrow|lend)\\b[^.]{0,30}?\\b(?:money|cash|funds?|loans?|savings|thousand|bank|\\d)|(?:buy|sell)\\b[^.]{0,30}?\\b(?:stocks?|shares|crypto\\w*|bitcoin|gold|propert(?:y|ies)|real estate|house|home|car|land|business|bonds?)|gamble\\b|take (?:out )?(?:a )?(?:loan|mortgage)|quit your job|put your money|sign (?:the|a) (?:lease|mortgage|contract))`,
  "\\b(?:now|today|this) (?:is|is the) (?:the |a )?(?:time|moment|right time|best time|perfect time|good time|great time|ideal time|wonderful time|smart time|wise time) to (?:invest(?! (?:more |some |extra )?(?:in(?:to)? )?(?:your|each|yourself|yourselves|the relationship|this relationship|communication|time|energy|trust|love|emotional|quality|being|learning|building|understanding|shared|mutual|small|one)\\b)|buy|sell|borrow|lend)\\b",
  `\\b${YOU}(?:'ll| will|'re going to| are going to) ${FORECAST_ADV}(?:make|lose|earn|gain|win|inherit|come into) (?:a (?:lot|fortune|bundle) of |lots of |big |serious |your |all your )?(?:money|a fortune)\\b(?! (?:decisions?|conversations?|talks?|matters?|choices|issues|habits|management|goals|worries|stress|arguments|differences))`,
  `\\b${YOU}(?:'ll| will|'re going to| are going to) ${FORECAST_ADV}(?:get|be|become) (?:very )?(?:rich|wealthy|a millionaire|broke|bankrupt)\\b`,
];
const FINANCIAL_STARTING = [
  `${FILLER}${NEG}(?:put|invest|pour|move|plow) (?:all |some |most |half |a lot )?(?:of )?(?:your |the |that |those )?(?:savings|money|cash|funds|salary|inheritance|capital|income) (?:into|in|on)\\b`,
  `${FILLER}${NEG}invest (?:\\w+ ){0,2}?in (?:\\w+ ){0,2}?(?:stocks?|shares|crypto\\w*|bitcoin|gold|silver|propert(?:y|ies)|real estate|funds?|bonds?|startups?|a (?:house|home|flat|apartment)|the (?:stock )?market)\\b`,
  `${FILLER}${NEG}(?:sell|buy|short) (?:(?:your|all your|the|those|these|some|a|an|this|that) )?(?:\\w+ )?${ASSET}`,
  `${FILLER}${NEG}(?:lend|loan|borrow)\\b[^.?!]{0,25}?\\b(?:money|cash|funds?|savings|loan)\\b`,
  `${FILLER}${NEG}(?:quit|leave) your job\\b`,
  `${FILLER}${NEG}(?:take out|sign) (?:a|the) (?:loan|mortgage|lease|contract)\\b`,
];

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** A rule as written: patterns may hold the NAME_SLOT. */
interface Template {
  category: PolicyCategory;
  /** The pattern as written, without the clause-start anchor. */
  raw: string;
  /** Matches only at the start of a clause. */
  starting: boolean;
  /** "A compatibility score is not something astrology offers" refuses; it does not score. */
  trailingRefusal: boolean;
  caseSensitive: boolean;
}

/** A template with the names filled in and the expression built. */
interface Rule extends Template {
  body: string;
  re: RegExp;
}

/** What may come before a clause-initial imperative: spaces, bullets, list markers. */
const STARTING_PREFIX =
  "^[\\s\\-*\\u2022\\u00b7\\u2192>\\u25aa\\u25b8\\u25e6\\u2023\\u2013\\u2014#]*(?:\\(?[a-z0-9]{1,2}[.)]\\s+)?";

function rules(
  category: PolicyCategory,
  sources: string[],
  {
    starting = false,
    trailingNouns = new Set<number>(),
    caseSensitive = false,
  } = {},
): Template[] {
  return sources.map((raw, i) => ({
    category,
    raw,
    starting,
    trailingRefusal: trailingNouns.has(i),
    caseSensitive,
  }));
}

function compile(t: Template, names: string): Rule {
  const body = t.raw.replaceAll(NAME_SLOT, names);
  return {
    ...t,
    body,
    re: t.starting
      ? new RegExp(`${STARTING_PREFIX}(?:${body})`, "i")
      : new RegExp(body, t.caseSensitive ? "g" : "gi"),
  };
}

const RULES: Template[] = [
  ...rules("directive", DIRECTIVE),
  ...rules("directive", DIRECTIVE_STARTING, { starting: true }),
  ...rules("prediction", PREDICTION),
  ...rules("score", SCORE, { trailingNouns: SCORE_NOUN_ONLY }),
  ...rules("score", SCORE_STARTING, { starting: true }),
  ...rules("diagnosis", DIAGNOSIS),
  ...rules("reproductive", REPRODUCTIVE),
  ...rules("medication", MEDICATION),
  ...rules("financial", FINANCIAL),
  ...rules("financial", FINANCIAL_STARTING, { starting: true }),
];
const CATEGORIES: PolicyCategory[] = [
  "directive",
  "prediction",
  "score",
  "diagnosis",
  "reproductive",
  "medication",
  "financial",
];

const union = (parts: string[], prefix = "") =>
  new RegExp(`${prefix}(?:${parts.map((p) => `(?:${p})`).join("|")})`, "i");

// ---------------------------------------------------------------------------
// What lets a match through
// ---------------------------------------------------------------------------

/** What a limitation says astrology cannot do. */
const CANNOT_DO = [
  "tell",
  "comment",
  "say",
  "predict",
  "forecast",
  "foresee",
  "diagnose",
  "decide",
  "determine",
  "know",
  "guarantee",
  "promise",
  "prescribe",
  "advise",
  "recommend",
  "confirm",
  "prove",
  "settle",
  "answer",
  "judge",
  "dictate",
  "replace",
  "substitute",
  "score",
  "rate",
  "measure",
  "assure",
  "choose",
];
// Directive and prediction lines must not be excused by "can't give you what
// you need", so "give" and friends only excuse the other categories.
const CANNOT_GIVE = [
  ...CANNOT_DO,
  "give",
  "assign",
  "provide",
  "offer",
  "calculate",
  "produce",
  "put",
  "show",
  "treat",
  "cure",
  "deal",
];
const NEVER_DO = [
  "predict",
  "diagnose",
  "guarantee",
  "promise",
  "decide",
  "score",
  "prescribe",
  "forecast",
];
const SAYING =
  "(?:say|tell|decide|judge|predict|determine|diagnose|advise|suggest|recommend|claim|assume|imply|dictate)";

/** "cannot", "isn't able to", "no chart can": the start of a limitation. */
const CANNOT = alt([
  "cannot",
  "can'?t",
  "can not",
  "could not",
  "couldn'?t",
  "won'?t",
  "will not",
  "wouldn'?t",
  "would not",
  "doesn'?t",
  "does not",
  "don'?t",
  "do not",
  "didn'?t",
  "isn'?t",
  "is not",
  "aren'?t",
  "are not",
  "am not",
  "i'?m not",
  "unable to",
  "not able to",
  "never",
  "(?:no|nobody|nothing)(?: \\w+){0,2}? (?:can|could|will)",
]);
const ABLE =
  "(?: (?:be )?(?:able|going|here|meant|designed|supposed|built|used) to)?";

const NEGATOR =
  "(?:\\bnot|\\bno|\\bnever|\\bnothing|\\bnobody|\\bno ?one|\\bnone|\\bwithout|\\bhardly|\\bbarely|\\bcannot|\\b\\w+n't)";
const CLAIMING_VERB =
  "(?:mean|means|meant|show|shows|prove|proves|indicate|indicates|imply|implies|suggest|suggests|say|says|tell|tells|signal|signals|confirm|confirms|predict|predicts|promise|guarantee|know|judge|read|treat|take|see|view|interpret|conclude|assume|believe|think|expect|claim|label|call|saying|said|suggesting|suggested|implying|implied|claiming|claimed|predicting|predicted|telling|told|recommending|recommended|advising|advised|promising|promised|guaranteeing|guaranteed|meaning|concluding|concluded|assuming|assumed|believing|thinking|thought|expecting|expected|asserting|asserted|insisting|insisted|stating|stated|declaring|declared|confirming|confirmed|diagnosing|diagnosed|labelling|labeling|labelled|labeled|calling|called|reading|judging|judged|determining|determined|forecasting|forecasted|foretelling|foretold|hinting|hinted|hint|hints|insinuating|insinuated|alleging|alleged|arguing|argued|contending)";
/**
 * Cues that say a claim is NOT being made, found by shape and not by a list of
 * sentences: a negator followed within a few words by a verb of saying or
 * concluding ("doesn't mean", "don't read this as", "can't confirm"), a negated
 * ground ("no evidence", "no reason", "not a sign"), a judgement that saying it
 * would be wrong ("a mistake to conclude", "unfair to claim"), a hypothetical
 * ("if I said", "instead of telling you"), and avoiding a conclusion ("hate for
 * you to come away thinking"). `limited` accepts one only when plain words
 * link it to the trigger, so a negator in a sibling clause or a condition
 * never excuses.
 */
const NOT_CLAIMING = [
  `${NEGATOR}\\b(?: [\\w']+){0,3}? ${CLAIMING_VERB}\\b`,
  `${NEGATOR}\\b(?: [\\w']+){0,2}? (?:evidence|proof|sign|signs|reason|reasons|basis|indication|guarantee|grounds|cause|true|the case|accurate|correct|certain|message|hint|clue|suggestion|implication|requirement|obligation|rule)\\b`,
  `\\b(?:unfair|wrong|a mistake|unwise|premature|misleading|presumptuous|irresponsible|unhelpful|too soon|too early)\\b(?: [\\w']+){0,3}? (?:say|claim|tell|conclude|assume|suggest|predict|read|call|label|promise|guess)\\b`,
  "\\b(?:if i (?:said|told you|were to say|claimed|promised|predicted)|instead of (?:telling|saying)|rather than (?:telling|saying)|would be making it up)\\b",
  "\\b(?:far be it from me to|not the same as|isn't me|is not me|this isn't me|that isn't me|me saying|nobody is|no one is) (?:say|saying|tell|telling|suggest|suggesting|claim|claiming|predict|predicting)\\b",
  "\\b(?:hate|avoid|prevent|discourage|wouldn't want|don't want|do not want)\\b(?: [\\w']+){0,5}? (?:think|thinking|assume|assuming|believe|believing|conclude|concluding|feel|feeling|fear|fearing)\\b",
];

const limitation = (verbs: string[]) =>
  [
    `\\b${CANNOT}${ABLE} (?:\\w+ly )?${alt(verbs)}\\b`,
    `\\bnever ${alt(NEVER_DO)}\\b`,
    "\\bnot (?:a |an )?(?:substitute|replacement) for\\b",
    `\\b(?:isn't|is not|not|wouldn't be|would not be) (?:for (?:me|us|astrology|a chart|the stars|any chart|a reading|anyone) to|my (?:place|role|job|call|decision|business|right) to|up to (?:me|us|astrology|a chart) to|my place|something (?:i|astrology|a chart|we) (?:can|could|should) ${SAYING})(?: ${SAYING})?\\b`,
    "\\b(?:not|never|in no|no) (?:in )?(?:a )?position to\\b",
    `\\b(?:would|will|'d) (?:not )?(?:be )?(?:wrong|unfair|unwise|a mistake|irresponsible|inappropriate|misleading|presumptuous|reckless|unkind) (?:for me )?to ${SAYING}\\b`,
    `\\b(?:would not|wouldn't|isn't|is not) (?:be )?(?:right|fair|wise|appropriate|responsible|helpful|honest|kind)(?: for me)? to ${SAYING}\\b`,
    "\\b(?:nothing|nobody|no ?one|none of (?:this|that|it|these|those))(?: \\w+){0,5}? (?:say|says|saying|tell|tells|telling|mean|means|meaning|show|shows|indicate|indicates|suggest|suggests|imply|implies|require|requires|demand|demands|dictate|dictates|decide|decides|prove|proves|determine|determines)\\b",
    "\\bno (?:\\w+ ){0,3}?(?:rule|law|chart|aspect|placement|sign|planet|transit|reading|astrologer|tradition)(?: \\w+){0,3}? (?:say|says|tell|tells|mean|means|show|shows|indicate|indicates|require|requires|demand|demands|dictate|dictates|prove|proves|decide|decides|determine|determines)\\b",
    "\\b(?:don't|doesn't|do not|does not|didn't|isn't|aren't|is not|are not|wouldn't|would not) (?:necessarily |automatically |always |really )?(?:mean|say|show|indicate|imply|suggest|prove|require|demand|dictate|decide|determine|tell|signal|guarantee)\\b",
    `\\bonly (?:you|you two|the two of you|you both|a (?:doctor|professional|therapist|pharmacist)) can (?:decide|say|know|tell|judge|determine|choose|answer|diagnose)\\b`,
    "\\b(?:isn't|is not|aren't|are not) (?:a |an |any )?(?:diagnos\\w+|predict\\w+|guarantee|forecast|verdict|score|rating|medical advice|financial advice|legal advice|professional advice)\\b",
    "\\bno (?:guarantee|promise|certainty|way to know|way of knowing)\\b",
    ...NOT_CLAIMING,
  ].join("|");
const NARROW_SOURCE = limitation(CANNOT_DO);
const WIDE_SOURCE = limitation(CANNOT_GIVE);
const LIMIT_NARROW = new RegExp(NARROW_SOURCE, "gi");
const LIMIT_WIDE = new RegExp(WIDE_SOURCE, "gi");
/** Any limitation at all, for "the same sentence also holds a limitation". */
const HAS_LIMITATION = new RegExp(WIDE_SOURCE, "i");

const GAP_BLOCK = new Set([
  "but",
  "yet",
  "so",
  "however",
  "though",
  "although",
  "still",
  "instead",
  "otherwise",
  "then",
  "because",
  "since",
  "while",
  "whereas",
  "nevertheless",
  "anyway",
  "enough",
  "again",
  "more",
  "than",
  "except",
  "i",
  "we",
]);
const GAP_LINK = new Set([
  "whether",
  "if",
  "that",
  "what",
  "when",
  "who",
  "how",
  "which",
  "why",
  "where",
]);

/**
 * Does a limitation that ends where `gap` begins still govern a trigger that
 * starts where `gap` ends? Only when they are linked by plain words (whether, if,
 * that, what, to ...) with no punctuation, contrast or new subject in between.
 */
function governs(gap: string): boolean {
  const trimmed = gap.trim();
  if (!trimmed) return true;
  const words = trimmed.split(" ");
  if (words.length > 8) return false;
  for (let k = 0; k < words.length; k++) {
    const w = words[k].toLowerCase();
    if (
      GAP_BLOCK.has(w) ||
      /[,;:.!?()\u2014\u2013]/.test(w) ||
      (w.length > 3 && w.endsWith("ly"))
    )
      return false;
    if (w === "and" || w === "or") {
      const next = words[k + 1];
      // "can't say if you are 80% compatible or 20% compatible": the second
      // trigger joins the first under the same cue, so a trailing "or" is fine
      // once a link word has been seen. Otherwise "and" opens a sibling clause.
      const joinsTrigger =
        w === "or" &&
        next === undefined &&
        words.slice(0, k).some((x) => GAP_LINK.has(x));
      if (!joinsTrigger && !GAP_LINK.has(next ?? "")) return false;
    }
  }
  return true;
}

function limited(before: string, wide: boolean): boolean {
  for (const cue of before.matchAll(wide ? LIMIT_WIDE : LIMIT_NARROW))
    if (governs(before.slice(cue.index + cue[0].length))) return true;
  return false;
}

// Directly before a match: "whether you should", "if you are".
const DOUBT_DIRECT = /\b(?:whether|if)(?: or not)?\s*$/i;
const OWN_WORDS =
  /\byou(?: both| two)?(?: \w+){0,2}? (?:feel|felt|feeling|think|thought|thinking|believe\w*|sense\w*|worr\w+|fear\w*|wonder\w*|wish\w*|hope\w*|assum\w+|expect\w*|imagin\w+|suspect\w*|say|said|told me|mentioned|described|wrote|noted|asked)(?: that)?\s*$/i;
const ATTRIBUTION =
  /\b(?:(?:some|many|most|other|certain|several|a few)(?: \w+){0,2} (?:claim|say|believe|think|argue|suggest|insist|warn|assume|read|interpret|predict|call)\w*|(?:people|others|apps|websites|sources|tradition|folklore|astrologers) (?:say|claim|call|suggest|believe))(?: that)?\s*$/i;
const NOUN_FRAME =
  /\b(?:fears?|worr(?:y|ies)|concerns?|ideas?|beliefs?|thoughts?|feelings?|sense|myths?|rumou?rs?|notions?|claims?|assumptions?|suspicions?|anxiety|dread|stor(?:y|ies)|phrases?|labels?|terms?)(?: that| of| about)?(?: an?| the)?\s*$/i;
/** A negator right before the verb: "please don't stop", "is no reason to skip". */
const NEGATION_NEAR =
  /(?:^|[\s(])(?:no|not|never|nothing|none|without|\w+n't|cannot)(?![\w'])(?: [\w']+){0,2} ?$/i;
/** Telling someone not to act on a chart is not advice to act. */
const ASTRO_BASIS_AFTER =
  /^[^.;]{0,50}?\b(?:because of|based on|on the basis of|just because|simply because|only because|solely because|due to|according to|relying on|rely on|on the strength of)\b[^.;]{0,40}?\b(?:chart|horoscope|astrolog\w*|transits?|retrograde|planets?|jupiter|saturn|venus|mars|mercury|moon|sun|stars?|reading|aspects?|signs?)\b/i;
const NEGATED_WORDS =
  /\b(?:shouldn't|should not|mustn't|must not|don't|do not|never|not)\b/i;
/** A question word earlier in the clause: "what your compatibility score is". */
const ASKING_BEFORE =
  /\b(?:what|how|whether|if|which|ask\w*|wonder\w*|curious|know)\b[^.;,:!?]{0,40}$/i;
const NEGATION_BEFORE =
  /(?:^|[\s(])(?:no|not|never|nothing|nobody|none|neither|nor|without|hardly|barely|nowhere|cannot|\w+n't|far from|rather than|instead of|wrong to|untrue that|false that|myth that)(?![\w'])[^.;,:!?]{0,50}$/i;
// "no doubt", "not only" are emphasis, not negation.
const NOT_REALLY_NEGATION =
  /\b(?:no|without) (?:a )?(?:doubt|question|denying|mistake)\b|\bnot (?:only|just)\b|\bnothing but\b/gi;

/** Single spaces, plain quotes, no zero-width characters or markdown marks. */
function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u200b-\u200d\u2060\ufeff\u00ad]/g, "")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[*_`~]/g, "")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(SCORE_COLON, "$1 is ");
}

// Sentences end at a full stop, a question or exclamation mark, or a new line. A
// semicolon splits a sentence into parts, but the parts still belong to one
// sentence for what "follows": "Let that go; it isn't meaningful."
const SENTENCE_END = /(?<=[.!?])["\u201d')]*\s+|\n+/;

const CLAUSE_BREAK = new RegExp(
  [
    "\\s*(?:\u2014|\u2013|--)\\s*",
    "\\s+-\\s+",
    ":\\s+",
    ",?\\s+(?:but|however|though|although|yet|whereas|nevertheless|nonetheless|otherwise|instead|except that)\\b,?\\s*",
    ",\\s+(?:so|still|while|whilst|then|and then)\\b,?\\s*",
    "\\s+so\\s+(?=(?:you|he|she|they|i|we|it|this|that|there|let|leave|go|stay|break|end|marry|divorce)\\b)",
  ].join("|"),
  "gi",
);

/** Drops the quotation marks and remembers which stretches were quoted. */
function stripQuotes(sentence: string): {
  plain: string;
  quoted: [number, number][];
} {
  if (!/["\u201c\u201d]/.test(sentence)) return { plain: sentence, quoted: [] };
  const parts: string[] = [];
  let length = 0;
  const quoted: [number, number][] = [];
  let open = -1;
  for (const ch of sentence) {
    if (ch === '"' || ch === "\u201c" || ch === "\u201d") {
      if (open < 0 && ch !== "\u201d") open = length;
      else if (open >= 0 && ch !== "\u201c") {
        quoted.push([open, length]);
        open = -1;
      }
    } else {
      parts.push(ch);
      length += ch.length;
    }
  }
  if (open >= 0) quoted.push([open, length]);
  return { plain: parts.join(""), quoted };
}

/** Largest index `i` with `sorted[i] <= value`. */
function floorIndex(sorted: number[], value: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sorted[mid] <= value) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const WINDOW = 120;

// ---------------------------------------------------------------------------
// The scanner: one engine shape for both tiers
// ---------------------------------------------------------------------------

interface Hit {
  category: PolicyCategory;
  text: string;
}

/** What an engine knows about one trigger when it decides whether it is excused. */
interface Ctx {
  rule: Rule;
  plain: string;
  start: number;
  end: number;
  text: string;
  /** The clause up to the trigger, at most WINDOW characters. */
  before: string;
  /** The sentence after this one: a refusal often follows a reported claim there. */
  next: string;
  /** The trigger sits in words the person wrote: `You asked, "Should I ...?"`. */
  userQuote: boolean;
}

interface Engine {
  groups: { category: PolicyCategory; own: Rule[]; any: RegExp }[];
  starting: Rule[];
  startingAny: RegExp | null;
  /** Can this sentence hold anything at all? One cheap test. */
  prefilter: RegExp;
  /** True when the trigger is excused. */
  excused: (c: Ctx) => boolean;
  /** Read "you should." after a clause that named an action. */
  ellipsis: boolean;
}

function buildEngine(
  templates: Template[],
  excused: (c: Ctx) => boolean,
  ellipsis: boolean,
  names: string,
  extraHints: string[] = [],
): Engine {
  const all = templates.map((t) => compile(t, names));
  const anywhere = all.filter((r) => !r.starting);
  const starting = all.filter((r) => r.starting);
  return {
    groups: CATEGORIES.map((category) => {
      const own = anywhere.filter((r) => r.category === category);
      return { category, own, any: union(own.map((r) => r.re.source)) };
    }).filter((g) => g.own.length > 0),
    starting,
    startingAny:
      starting.length > 0
        ? union(
            starting.map((r) => r.body),
            STARTING_PREFIX,
          )
        : null,
    prefilter: union([
      ...anywhere.map((r) => r.re.source),
      ...starting.map((r) => r.body),
      ...extraHints.map((h) => h.replaceAll(NAME_SLOT, names)),
    ]),
    excused,
    ellipsis,
  };
}

/** "Compatibility: 78/100" reads as "compatibility is 78/100". */
const SCORE_COLON =
  /\b(compatibility|score|rating|match|harmony|overall|total)\s*:\s*(?=\d)/gi;

/**
 * What comes right before a quotation that is the person's own words: `You
 * asked, "..."`, `You wrote: "..."`, `Your question was, "..."`.
 */
const USER_QUOTE_FRAME =
  /(?:\byou(?: \w+){0,2}? (?:asked|wrote|said|typed|messaged|texted|emailed|put it|told me|mentioned|added|replied)(?: me)?(?: this| it| that| the following)?|\byour (?:question|message|note|text|post|email)(?: was| said| read| reads)?)[,:]?\s*$/i;

/** "you should." after a clause that named an action. */
const ELLIPSIS =
  /^(?:(?:yes|honestly|really|and|but|so)[, ]+)*(?:you|you two|you both)(?: (?:really|definitely|absolutely|probably|certainly|truly|simply))? (?:should|must|ought to|need to|have to|had better)[.!]?$/i;
const ACTION_ANYWHERE = new RegExp(
  ACTION.replaceAll(NAME_SLOT, NAME_PATTERN),
  "i",
);

/** Findings in one assertion, one per category. `prior` is the question just before it. */
function scan(
  sentence: string,
  prior: string,
  engine: Engine,
  next = "",
): Hit[] {
  const read = sentence.replace(SCORE_COLON, "$1 is ");
  const { plain, quoted } = stripQuotes(read);
  const starts = [0];
  const ends: number[] = [];
  for (const b of plain.matchAll(CLAUSE_BREAK)) {
    ends.push(b.index);
    starts.push(b.index + b[0].length);
  }
  ends.push(plain.length);

  const quotedStarts = quoted.map(([a]) => a);
  const hits = new Map<PolicyCategory, string>();
  let sentenceLimited: boolean | undefined;

  const consider = (
    rule: Rule,
    start: number,
    end: number,
    text: string,
  ): void => {
    if (hits.has(rule.category)) return;
    const clauseStart = starts[floorIndex(starts, start)];
    const before = plain.slice(Math.max(clauseStart, start - WINDOW), start);

    let userQuote = false;
    if (quoted.length > 0) {
      // Quoted stretches are sorted and apart, so the last one that opens
      // before this match ends is the only one that can overlap it.
      const q = quoted[floorIndex(quotedStarts, end - 1)];
      if (q && q[0] < end && q[1] > start) {
        sentenceLimited ??= HAS_LIMITATION.test(plain);
        if (sentenceLimited) return;
        userQuote = USER_QUOTE_FRAME.test(
          plain.slice(Math.max(0, q[0] - 40), q[0]),
        );
      }
    }
    if (
      engine.excused({ rule, plain, start, end, text, before, next, userQuote })
    )
      return;
    hits.set(rule.category, text);
  };

  for (const { category, own, any } of engine.groups) {
    if (!any.test(plain)) continue;
    for (const rule of own) {
      for (const m of plain.matchAll(rule.re)) {
        consider(rule, m.index, m.index + m[0].length, m[0].trim());
        if (hits.has(category)) break;
      }
      if (hits.has(category)) break;
    }
  }
  for (let k = 0; k < starts.length; k++) {
    const slice = plain.slice(starts[k], ends[k]);
    const clause = slice.trim();
    if (!clause) continue;
    const offset = starts[k] + (slice.length - slice.trimStart().length);
    if (engine.startingAny?.test(clause))
      for (const rule of engine.starting) {
        if (hits.has(rule.category)) continue;
        const m = rule.re.exec(clause);
        if (m) consider(rule, offset, offset + m[0].length, m[0].trim());
      }
    if (engine.ellipsis && !hits.has("directive") && ELLIPSIS.test(clause)) {
      const previous = k > 0 ? plain.slice(starts[k - 1], ends[k - 1]) : prior;
      if (previous && ACTION_ANYWHERE.test(previous))
        hits.set("directive", clause);
    }
  }
  return [...hits].map(([category, text]) => ({ category, text }));
}

// ---------------------------------------------------------------------------
// FLAG tier: the broad filter
// ---------------------------------------------------------------------------

const SPEC: Record<
  PolicyCategory,
  { wide: boolean; negation: boolean; attribution: boolean; medical: boolean }
> = {
  directive: {
    wide: false,
    negation: false,
    attribution: false,
    medical: false,
  },
  prediction: {
    wide: false,
    negation: true,
    attribution: true,
    medical: false,
  },
  score: { wide: true, negation: true, attribution: true, medical: false },
  diagnosis: { wide: true, negation: true, attribution: true, medical: false },
  reproductive: {
    wide: true,
    negation: true,
    attribution: false,
    medical: false,
  },
  medication: { wide: true, negation: true, attribution: false, medical: true },
  financial: {
    wide: true,
    negation: false,
    attribution: false,
    medical: false,
  },
};

/** The person agrees with their own words: "you think you should leave him, and you are right". */
const ENDORSED =
  /\b(?:i agree|agree with you|you(?:'re| are) (?:right|correct)|(?:that is|that's|it is|it's) (?:right|true|correct)|i think so too|exactly right|(?:you|she|he|they)(?:'re|'s| are| is) (?:absolutely |completely |totally |quite |entirely |so )?(?:right|correct)|spot on|i can't argue with (?:that|it)|fair enough|that(?:'s| is) exactly (?:what|how|why)|i(?:'d| would) give you the same|i don't disagree|i wouldn't be surprised|nothing in your charts? contradicts|(?:that|it)(?:'s| is) accurate|(?:is|are|was|were|seems?) (?:fully |entirely |quite |well )?(?:justified|valid|warranted|well-founded|founded|accurate))\b/i;

function broadExcused({ rule, plain, end, text, before }: Ctx): boolean {
  const { category } = rule;
  const spec = SPEC[category];
  if (DOUBT_DIRECT.test(before)) return true;
  if (OWN_WORDS.test(before) && !ENDORSED.test(plain.slice(end, end + 80)))
    return true;
  if (spec.attribution && (ATTRIBUTION.test(before) || NOUN_FRAME.test(before)))
    return true;
  if (spec.negation) {
    const scrubbed = before.replace(NOT_REALLY_NEGATION, "so");
    if (
      (category === "medication" ? NEGATION_NEAR : NEGATION_BEFORE).test(
        scrubbed,
      )
    )
      return true;
  }
  if (
    category === "financial" &&
    NEGATED_WORDS.test(text) &&
    ASTRO_BASIS_AFTER.test(plain.slice(end, end + 110))
  )
    return true;
  if (limited(before, spec.wide)) return true;
  if (spec.medical) {
    if (DOCTOR_BEFORE.test(before)) return true;
    if (PRESCRIBED_AFTER.test(plain.slice(end, end + 60))) return true;
  }
  if (
    rule.trailingRefusal &&
    (ASKING_BEFORE.test(before) ||
      TRAILING_REFUSAL.test(plain.slice(end, end + 60)))
  )
    return true;
  return false;
}

const buildBroad = (names: string) =>
  buildEngine(RULES, broadExcused, true, names, [`(?:${ACTION})`]);

// ---------------------------------------------------------------------------
// BLOCK tier: a small core where a wrong call is expensive, so it stays precise
//
// Only this tier makes the services retry and fall back. It holds what is
// plainly advice, a verdict or an instruction, in a few fixed shapes:
//   directive     you + should/must/need to/have to/ought to/had better + leave
//                 him or her, break up, split up, divorce, end the relationship,
//                 dump him, marry, get married, propose (a negated marry or
//                 propose still blocks; a negated leave or break up is flag
//                 only); "what you should do is ..."; "my advice is", "I
//                 recommend", "it's time to", "you're better off without him";
//                 clause-initial "Leave him.", "Break up with ...", "Divorce
//                 him.", "Dump him." (positive only)
//   prediction    the couple or a partner + will / is going to + (any -ly
//                 adverb, most likely, almost certainly ...) + break up,
//                 divorce, split up, fail, end in, cheat, get married, last
//                 forever, have a baby / children, leave you (him, her);
//                 "is doomed", "destined to fail/end", "is guaranteed to
//                 last". "Probably", might, may and could are flag only.
//   score         a number with % next to compatible / match / chance / likely;
//                 N/10, N/100, "eight out of ten"; "compatibility score of N";
//                 "I'd give you a N"
//   diagnosis     a person + is / has / suffers from / shows signs of / sounds
//                 like + a named condition from a fixed list (narcissist,
//                 narcissistic personality, psychopath, sociopath, bipolar,
//                 depression, clinically depressed, anxiety disorder, ADHD,
//                 autism, PTSD, borderline, personality disorder, schizophrenia,
//                 OCD). Adjectives such as "a narcissistic streak" are not here.
//   medication    stop / quit / skip / come off / go off / don't take / never
//                 take + your / the / his / her medication, meds, pills, dose,
//                 or a named medicine (sertraline, lithium, metformin,
//                 warfarin, statins, insulin, antibiotics, an inhaler ...)
//   reproductive  you / she + are / is / will be / will get + pregnant (also
//                 "pregnant with twins", not "pregnant with possibility") or
//                 infertile; can't / won't be able to + conceive / have children
//   financial     you + should / must / need to + invest / buy / sell / borrow /
//                 lend + money, shares, crypto, property, a house, that house,
//                 a car (buy or sell), "lend Sam the money" ...; "now is the
//                 time to invest / buy / sell / borrow / lend"
// Trust, forgive, stay, move in, have a baby, start a family, "leave your job"
// and the like are common in ordinary prose, so they are only flagged.
//
// A limitation or "not claiming" cue excuses only what it governs earlier in
// the same clause; a negator in a sibling or conditional clause ("without real
// change this relationship is doomed", "if he doesn't change you will break
// up") never does. A claim the person made or someone around them made ("you
// asked whether ...", "as you mentioned, ...") is excused unless the sentence
// endorses it; one attributed to a generic third party ("some astrologers
// claim ...") only when the same sentence then pushes it away; a bare "many
// astrologers would say it is doomed" is the assistant's own forecast. A dash,
// bracket, slash or spaced hyphen ends a verb phrase like a comma does.
// Deliberate choices, pinned in the tests: a
// plain "is depressed" and "narcissistic traits" are flag-tier only, while "has
// depression", "is a narcissist" and "clinically depressed" block; "won't
// survive", "won't last" and "has no future" block for the relationship or the
// two of them (not for "you won't survive the heat").
// ---------------------------------------------------------------------------

const B_SUBJ = "(?:you|you two|you both|both of you|the two of you)";
// A person is him, her, a role noun or a name the caller supplied. Never "them"
// (it is as often things as people), and never an object with a complement.
const B_OBJ = `(?:him|her|your (?:partner|husband|wife|boyfriend|girlfriend|spouse|fianc\\w+)|${NAME_SLOT})(?![\\w'])`;

// Where a verb phrase may stop. "leave him guessing", "leave her a note",
// "leave him to it" and "leave him alone" do not stop here, so they never match.
const B_END =
  "(?=\\s*(?:$|[.,!?;:)\\u2014\\u2013(\\[/]|--|-(?=\\s))|\\s+(?:now|today|immediately|soon|right away|asap|already|for good|tonight|tomorrow|this (?:week|month|year|summer|spring|autumn|winter)|next (?:week|month|year)|and|because|before|while|but|or|since|once|if|unless|altogether|completely|entirely)\\b)";
// A bare "leave" is the verb only at the very end of a sentence ("Yes, you should leave.").
const B_STRICT_END = "(?=\\s*(?:$|[.!?;:)]))";

// Leaving, splitting, divorcing. Said negatively these are advice to stay,
// which is common in reassurance, so only the flag tier reads them.
const B_VP_STAY = alt([
  `leave ${B_OBJ}${B_END}`,
  `end it with ${B_OBJ}`,
  "leave (?:the|your|this|that|our) (?:relationship|marriage)",
  `break ?up(?: with ${B_OBJ}|${B_END})`,
  `split up(?: with ${B_OBJ}|${B_END})`,
  `divorce(?: ${B_OBJ}|${B_END})`,
  "get (?:a divorce|divorced)\\b",
  "file for divorce",
  "end (?:the|your|this|that|our) (?:relationship|marriage)",
  `dump ${B_OBJ}`,
]);
// Marrying and proposing are block in both polarities.
const B_VP_WED = alt([
  `marry(?: ${B_OBJ}|${B_END})`,
  "get married(?! to (?:the|an?|this|that|these|those|my|your|his|her|their|our|each|every)\\b)",
  `propose(?: to ${B_OBJ}|${B_END})`,
]);
const B_VP = alt([B_VP_STAY, B_VP_WED]);
const B_GER_STAY = alt([
  `leaving ${B_OBJ}${B_END}`,
  `breaking up(?: with ${B_OBJ}|${B_END})`,
  `splitting up${B_END}`,
  `divorcing(?: ${B_OBJ}|${B_END})`,
  "ending (?:the|your|this) (?:relationship|marriage)",
]);
const B_GER_WED = alt([
  `marrying ${B_OBJ}`,
  "getting married(?! to (?:the|an?|this|that|these|those|my|your|his|her|their|our|each|every)\\b)",
]);

const B_MODAL_POS = alt([
  "should",
  "must",
  "needs? to",
  "have to",
  "ought to",
  "had better",
  "better",
  "will have to",
  "will need to",
  "have got to",
  "got to",
]);
const B_MODAL_NEG = alt([
  "should(?:n't| not| never)",
  "must(?:n't| not| never)",
  "ought not to",
  "oughtn't to",
  "had better not",
  "better not",
]);
const B_ADV = alt([
  "[a-z]+ly",
  "really",
  "just",
  "also",
  "both",
  "still",
  "simply",
  "truly",
  "maybe",
  "perhaps",
  "now",
  "then",
  "even",
  "all",
  "100%",
  "ever",
  "already",
  "too",
  "do",
]);
const B_GAP = `(?:${B_ADV},? ){0,4}`;
const B_FRAME = alt([
  "my (?:advice|suggestion|recommendation) (?:is|would be)",
  "i(?:'d| would)?(?: (?:strongly|really|definitely|honestly|personally|highly|gently|kindly))? (?:recommend|suggest|advise)",
  "it(?:'s| is) time",
  "all i can say is",
]);
const B_FRAME_TAIL =
  "(?: that| for)?(?: you(?: two| both)?)?(?: should)?(?: to)?,? ";

const BLOCK_DIRECTIVE = [
  // "You should leave him." A bare "leave" counts here, at the end of a sentence.
  `\\b${B_SUBJ}(?:,? ${B_GAP}${B_MODAL_POS}|'(?:ll (?:have|need) to|ve got to|d better)(?! not)),? ${B_GAP}(?:${B_VP}|leave${B_STRICT_END})`,
  // "You shouldn't marry him." A negated leave or break up is flag only.
  `\\b${B_SUBJ}(?:,? ${B_GAP}${B_MODAL_NEG}|'d better not),? ${B_GAP}${B_VP_WED}`,
  // "You should definitely not marry him."
  `\\b${B_SUBJ}(?:,? ${B_GAP}${B_MODAL_POS}),? ${B_GAP}(?:not|never) ${B_VP_WED}`,
  // "What you should do is leave him."
  `\\bwhat ${B_SUBJ} ${B_GAP}(?:should|must|need to|have to|ought to) do,? is,? (?:to )?${B_VP}`,
  // "My advice is to leave him.", "I recommend ending the marriage.", "It's time to break up."
  `\\b${B_FRAME}${B_FRAME_TAIL}(?:${B_VP}|${B_GER_STAY}|${B_GER_WED})`,
  `\\b${B_FRAME}${B_FRAME_TAIL}(?:not|never) (?:${B_VP_WED}|${B_GER_WED})`,
  `\\b(?:you(?:'re| are)|you(?:'d| would) be) better off without ${B_OBJ}`,
  // "It's time you left him."
  `\\bit(?:'s| is) (?:high )?time (?:that )?you(?: two| both)? (?:left ${B_OBJ}|broke up\\b|split up\\b|divorced ${B_OBJ}|ended (?:the|your|this) (?:relationship|marriage))`,
];
const B_FILL =
  "(?:(?:please|just|honestly|really|yes|so|well|and|then|now|simply|do|go ahead and)[, ]+){0,3}";
// Only a short discourse marker may come before an imperative, never a
// subordinate clause: "Bottom line, leave him." but not "When he sulks, leave him."
const B_LEAD =
  "(?:(?:bottom line|honestly|frankly|in short|simply put|my advice|my honest advice|in the end|to be honest|truthfully|realistically|ultimately|basically|short answer|the answer),? )?";
// A negated imperative ("Don't leave him.") is flag only.
const BLOCK_DIRECTIVE_STARTING = [
  `${B_LEAD}${B_FILL}(?:leave ${B_OBJ}${B_END}|break ?up with ${B_OBJ}|divorce ${B_OBJ}|dump ${B_OBJ})`,
];

const B_COUPLE_NOUN =
  "(?:relationship|marriage|couple|pairing|union|partnership|engagement|romance|bond)";
// "your relationship with him", "your marriage to Sam"
const B_COUPLE_NP = `(?:this|the|your|our|that) ${B_COUPLE_NOUN}(?: (?:with|to) ${B_OBJ})?`;
const B_PSUBJ = alt([
  B_SUBJ,
  B_COUPLE_NP,
  "your (?:partner|husband|wife|boyfriend|girlfriend)",
  "he",
  "she",
  "they",
  NAME_SLOT,
  `you and ${NAME_SLOT}`,
  `${NAME_SLOT} and you`,
]);
// Who "won't survive" and "has no future" may be said about: the relationship
// itself or the two of them, not "you won't survive the heat".
const B_UNION = alt([
  B_COUPLE_NP,
  "(?:this|the|your|our|that) (?:love|friendship)",
  "you two",
  "you both",
  "both of you",
  "the two of you",
  `you and ${NAME_SLOT}`,
  `${NAME_SLOT} and you`,
]);
// Adverbs a forecast may carry and still be a forecast: any -ly word ("sadly",
// "most likely", "honestly", "inevitably") and a few phrases. "Probably",
// "possibly" and the like are hedges and stay with the flag tier, as do
// might / may / could.
const B_PADV =
  "(?:(?:(?!(?:probably|possibly|hardly|barely|rarely|only|merely|nearly|partly|mostly|hopefully|apparently|supposedly|roughly|seemingly|perhaps) )[a-z]+ly|very likely|most likely|almost certainly|in all likelihood|without a doubt|one day|someday|soon|also|both) ){0,2}";
// "end" and "fail" must close the clause or be followed by a time or manner
// word, so "you will end up laughing" and "he will end the call" stay clear.
const closing = (words: string) =>
  `(?=\\s*(?:$|[.,!?;:)\\u2014\\u2013(\\[/]|--|-(?=\\s))|\\s+(?:${words})\\b)`;
// What may follow a verb that is a forecast: a time, a conjunction or the end.
const PREDICT_NEXT =
  "soon|eventually|within|before|by|after|next|this|in|over|again|and|but|if|when|because|unless|once|for good|badly";
// "will have a baby": the child must close the phrase or be followed by a time.
// "kids over" and "children in your class" are hosting and school, not a forecast,
// so "in" needs a year or a stretch of time.
const B_BABY = `have (?:a |another |two |three |twin )?(?:baby|babies|child|children|kids?|twins)(?: (?:girl|boy|daughter|son))?${closing("soon|eventually|within|before|by|after|next|this|again|but|if|when|because|unless|once|for good|in (?:\\d+|a (?:year|few|couple)|the (?:next|coming|new)|(?:january|february|march|april|may|june|july|august|september|october|november|december|spring|summer|autumn|winter)\\b)")}`;
// "will leave you": a person leaves the other; "leave you a note" does not close,
// and a time or place phrase ("soon after dinner", "at the station", "after the
// party") is a visit ending. "will leave you soon" alone is the person's call.
const B_LEAVES = `leave (?:you|him|her|each other)${closing("soon(?! after)|eventually|within|next|again|for good|for (?:him|her|someone|somebody|another \\w+)|by (?:next|the end)|this (?:year|month|week|summer|spring|autumn|winter)")}`;
const B_OUTCOME = `(?:${B_BABY}|${B_LEAVES}|break ?up(?! (?:the|a|an|into|any|big|large|long)\\b)|split up${closing(PREDICT_NEXT)}|divorce${closing(`${PREDICT_NEXT}|you|him|her|them|each other`)}|get divorced|fail${closing("eventually|soon|badly|miserably|completely|in|within|before|by \\d+|by (?:next|the end|this)|after")}|end in\\b|end${closing("badly|soon|sadly|abruptly|painfully|eventually|before|by \\d+|by (?:next|the end|this)|within|after|next|this|in|is|was|are|were|and|but|if|when|because|unless|once")}|cheat\\b(?! at\\b)|get married(?! to (?:the|an?|this|that|these|those|my|your|his|her|their)\\b)|last forever)`;
// "won't survive the winter commute": only a stretch of time may follow.
const B_NO_OBJECT =
  "(?! (?:the|a|an|this|that|these|those|my|your|his|her|their|any|another|each|every) (?!year\\b|summer\\b|winter\\b|month\\b|week\\b|spring\\b|autumn\\b|move\\b|wedding\\b|separation\\b|distance\\b|test\\b))";
const BLOCK_PREDICTION = [
  `\\b${B_PSUBJ}(?: (?:will|is going to|are going to|is bound to|are bound to|is destined to|are destined to)|'ll|'s going to|'re going to) ${B_PADV}${B_OUTCOME}`,
  `\\b${B_PSUBJ} (?:is|are|'s|'re) ${INTENSIFIER}(?:doomed(?! to\\b(?! (?:fail|end)))|destined to (?:fail|end)|bound to fail)`,
  // "would call this marriage doomed"
  `(?<=\\b(?:call|calls|called|consider|considers|considered|deem|deems|see|sees|view|views) )${B_COUPLE_NP} (?:as )?doomed\\b`,
  // A relationship that does not make it: "will not survive", "won't last".
  `\\b${B_UNION} (?:won't|will not|isn't going to|is not going to|aren't going to|are not going to|will never) ${B_PADV}(?:survive|last|make it)\\b${B_NO_OBJECT}`,
  `\\b${B_UNION} (?:has|have) no future\\b`,
  // "This relationship is guaranteed to last."
  `\\b${B_UNION} (?:is|are|'s|'re) ${INTENSIFIER}(?:guaranteed|fated|destined) to (?:last|survive|succeed|endure|work out|stay together)\\b`,
];

const B_PCT = "(?:\\d{1,3}(?:\\.\\d{1,2})? ?(?:%|percent|per ?cent))";
// What a chance or a likelihood is about when it is a forecast for the couple.
const B_ABOUT_US =
  "(?:stay together|stays together|stay married|break ?up|split|divorc\\w*|marr\\w*|last\\w*|cheat\\w*|works? out|make it|succe\\w+|fail\\w*|end\\b|survive|get back|propos\\w*|be together)";
// A bare "7/10" scores only when it stands alone or sits next to a rating word.
const B_SCORE_NEXT =
  "(?=\\s*(?:$|[.,!?;:)\\u2014\\u2013(\\[/]|--|-(?=\\s))|\\s+(?:for|overall|compatib\\w*|match\\w*|potential|chemistry|communication|together|long|romance|love|relationship|and|but|so)\\b)";
const BLOCK_SCORE = [
  `\\b${B_PCT} (?:\\w+ ){0,2}?(?:compatible|compatibility|match(?:ed)?)\\b`,
  `\\b${B_PCT} (?:chance|likelihood|probability|odds)(?: of| that)?[^.?!;:]{0,40}?\\b${B_ABOUT_US}`,
  `\\b${B_PCT} (?:\\w+ ){0,2}?likely\\b(?: to| that)?[^.?!;:]{0,40}?\\b${B_ABOUT_US}`,
  // A source in between ("a compatibility site gave you 38%") is an echo, not a score.
  `\\b(?:compatib\\w*|match(?:ed)?)\\b(?:(?!\\b(?:gave|gives|put|puts|rated|rates|said|says|showed|shows|scored|scores|estimated|calculated|got)\\b)[^.?!;:]){0,30}?\\b${B_PCT}`,
  `\\b(?:chances?|likelihood|odds)(?: of| that)?[^.?!;:]{0,30}?\\b${B_ABOUT_US}[^.?!;:]{0,25}?\\b${B_PCT}`,
  `(?<![\\d/.])(?<!\\b(?:on|by|until|from|since|before|after|due) )\\b\\d{1,2}(?:\\.\\d)? ?(?:/|out of) ?10\\b(?![/\\d]|\\.\\d)${B_SCORE_NEXT}`,
  `(?<![\\d/.])\\b\\d{1,3} ?(?:/|out of) ?100\\b(?![/\\d]|\\.\\d)${B_SCORE_NEXT}`,
  `\\b${NUM_WORD} out of (?:ten|a hundred|one hundred)\\b${B_SCORE_NEXT}`,
  `\\b(?:compatibility|match|love|relationship) (?:score|rating|percentage|index|level) (?:of|is|at|was|=) (?:about |around |roughly )?\\d{1,3}\\b(?! (?:minutes|hours|days|weeks|months|years|times|degrees))`,
  `\\bi(?:'d| would|'ll| will)? (?:give|rate|score) (?:you|your|this|it|that|the|these)\\b[^.?!]{0,25}?\\b(?:an?|at) (?:(?:solid|strong|good|high|low|clear|full|firm|easy) )?\\d{1,2}(?:\\.\\d)?\\b(?! (?:minutes|hours|days|weeks|months|years|times|more|degrees))`,
];

const B_CONDITION = alt([
  "narcissis[tm]\\b",
  "narcissistic personality(?: disorder)?",
  "psychopath(?:y|ic)?\\b",
  "sociopath(?:y|ic)?\\b",
  "bipolar(?: disorder)?",
  "depression\\b",
  "clinical depression",
  "clinically depressed",
  "anxiety disorder",
  "adhd",
  "autism\\b",
  "autistic\\b",
  "ptsd",
  "borderline personality(?: disorder)?",
  "borderline(?=\\s*(?:$|[.,!?;:]))",
  "(?:\\w+ )?personality disorder",
  "schizophreni\\w+",
  "ocd",
]);
// "Autism awareness day" is not a diagnosis, nor is "a narcissist's opposite".
// A condition is the head of its phrase: "has ADHD", "is bipolar, I think", not
// "bipolar opposites" or "autism awareness".
const B_NOT_TOPIC =
  "(?!-)(?!'s)(?! (?:awareness|spectrum|support|research|diagnosis|assessment|services?|month|day|week|charity|foundation|statistics|rates?)\\b)(?=\\s*(?:$|[.,!?;:)\\u2014\\u2013(\\[/]|--|-(?=\\s))|\\s+(?:and|or|but|because|since|so|which|that|who|as|too|also|again|now|today|for|from|in|at|on|with|when|while|if|really|badly|seriously|clearly|probably|himself|herself|yourself|like|than|though|although|then|until|after|before|last|every|this|i|you|he|she|they|it|though)\\b)";
const B_DADV = adverbs([
  "probably",
  "likely",
  "definitely",
  "clearly",
  "certainly",
  "obviously",
  "actually",
  "really",
  "just",
  "almost certainly",
]);
const B_DVERB = alt([
  "is",
  "are",
  "'s",
  "'re",
  "has",
  "have",
  "suffers? from",
  "suffering from",
  "shows? signs of",
  "sounds? like",
]);
const B_DARTICLE =
  "(?:(?:a|an|the|severe|mild|clear|classic|textbook|real|total|full-blown|undiagnosed) ){0,2}";
const NAME_START_NOT =
  "(?!(?:This|That|There|These|Those|Here|What|Which|When|Where|While|Sun|Moon|Mercury|Venus|Mars|Jupiter|Saturn|Uranus|Neptune|Pluto|Chiron|Love|Life|Your|Our|His|Her|Their|Many|Some|Most|Both|Each|Every|Someone|Anyone|Everyone|Nobody|Everything|Something|Nothing)\\b)";
const BLOCK_DIAGNOSIS = [
  `\\b(?:you|he|she|they|your (?:partner|husband|wife|boyfriend|girlfriend|ex|fianc\\w+)|${NAME_SLOT}) ?${B_DADV}${B_DVERB} ${B_DADV}${B_DARTICLE}${B_CONDITION}${B_NOT_TOPIC}`,
];
// A name-like capitalised word as the subject: case sensitive, so the rest is lower case.
const BLOCK_DIAGNOSIS_NAME = `\\b${NAME_START_NOT}[A-Z][a-z]{2,} ?${B_DADV}${B_DVERB} ${B_DADV}${B_DARTICLE}${B_CONDITION.replace(/adhd|ptsd|ocd/g, (m) => m.toUpperCase())}${B_NOT_TOPIC}`;

// The medication noun must be the head of its phrase ("your blood pressure
// medication", "tonight's dose"), not a modifier ("medication advice").
const B_MED_NOUN = `(?:medications?|medicines?|meds|pills?|tablets|capsules|antidepressants?|antipsychotics?|ssris?|insulin|prescriptions?|doses?|dosage|birth control|sertraline|fluoxetine|escitalopram|citalopram|paroxetine|venlafaxine|bupropion|lithium|lamotrigine|quetiapine|olanzapine|aripiprazole|risperidone|methylphenidate|adderall|ritalin|prozac|zoloft|lexapro|wellbutrin|${OTHER_MEDICINES})`;
const B_MED_OWNER =
  "(?:(?:your|the|his|her|their|any|all|those|these|my|that|this|every|each|a|an|tonight's|today's|tomorrow's) )";
const B_MED_HEAD =
  "(?=\\s*(?:$|[.,!?;:)\\u2014\\u2013(\\[/]|--|-(?=\\s))|\\s+(?:for|and|or|but|because|today|tonight|tomorrow|this|now|as|when|until|while|again|altogether|completely|immediately|right|at|without|to|if|so|unless|on|in|by|from|during|whenever|after|before|slowly|gradually|cold|suddenly|abruptly|early|entirely|just|then|too|anymore|any|since|once|with|of|that|which)\\b)";
// An owner is optional and up to three words may describe the drug.
// A modifier is a describing word, never a conjunction or a preposition, so a list
// such as "start, stop or change a medication" is not an instruction to stop.
const B_MED_MOD =
  "(?:(?!(?:or|and|but|to|of|for|in|on|at|with|by|that|if|so|because|then|than|when|while|not|your|the|about|over|from|into|through|around|against|as)\\b)(?![a-z]+ing )[a-z-]+ )";
const B_MED = `${B_MED_OWNER}?${B_MED_MOD}{0,3}${B_MED_NOUN}${B_MED_HEAD}`;
const BLOCK_MEDICATION = [
  `\\b(?:stop(?: taking| using)?|quit(?: taking)?|skip(?:ping)?|come off|go off|going off) ${B_MED}`,
  // A negated "take" is an instruction to stop, never an excuse.
  `\\b(?:don't|do not|never|shouldn't|should not|mustn't|must not) (?:take|use) ${B_MED}`,
  `\\byou (?:don't|do not|no longer|won't) need (?:to (?:take|use|keep taking) )?${B_MED}`,
];

const B_PERSON_SHE = `(?:you|she|your (?:partner|wife|girlfriend|fianc\\w+)|${NAME_SLOT})`;
const BLOCK_REPRODUCTIVE = [
  `\\b${B_PERSON_SHE} ?(?:is|are|'s|'re|will be|'ll be|must be|will get|'ll get|will become) ${adverbs(["probably", "definitely", "likely", "already", "really"])}(?:pregnant(?! (?:with|of)\\b(?! (?:twins|triplets|quadruplets|a (?:baby|boy|girl|child|son|daughter)|baby|child|children|(?:her|your|their) (?:first|second|third))\\b))|infertile)\\b`,
  `\\b${B_PERSON_SHE}(?: (?:can't|cannot|can not|won't be able to|will not be able to|will never)|'ll never) (?:be able to )?(?:conceive(?! of\\b)|get pregnant|have (?:a )?(?:children|child|baby|babies|kids?))\\b`,
];

const B_MONEY_WORD =
  "(?:money|stocks?|shares|crypto\\w*|bitcoin|propert(?:y|ies)|house|home|savings|cash|funds?|gold|real estate|land|business|flat|apartment|startup|bonds?)";
// The money word ends the phrase: "invest in property", "invest in the stock market",
// not "invest in the home you are building together".
const B_MONEY_END =
  "(?=\\s*(?:$|[.,!?;:)\\u2014\\u2013(\\[/]|--|-(?=\\s))|\\s+(?:market|exchange|portfolio|account|from|to|for|at|with|of|on|out|in|into|together|jointly|and|or|but|because|now|today|tonight|tomorrow|right away|immediately|soon|before|while|if|unless|this|next)\\b)";
// What may sit between the verb and the money word: determiners, "that house",
// a person ("lend Sam the money").
const B_FIN_FILL = `(?: (?:in|into|some|all|your|the|his|her|their|a|an|more|any|them|him|us|our|joint|shared|jointly|together|out|up|new|second|small|that|this|these|those|${NAME_SLOT})){0,4}`;
const B_FIN_VP = alt([
  `(?:invest|buy|sell|borrow|lend)\\b${B_FIN_FILL} ${B_MONEY_WORD}${B_MONEY_END}`,
  // A car is bought or sold, not something one lends.
  `(?:buy|sell)\\b${B_FIN_FILL} (?:car|vehicle)${B_MONEY_END}`,
]);
// "Now is the time to invest.": the verb alone must close the clause.
const B_FIN_BARE =
  "(?:invest|buy|sell|borrow|lend)(?=\\s*(?:$|[.,!?;:)\\u2014\\u2013]))";
const BLOCK_FINANCIAL = [
  `\\b${B_SUBJ} ${B_GAP}(?:should(?:n't| not)?|must(?:n't| not)?|needs? to|have to|ought to|had better),? ${B_GAP}(?:(?:not|never) )?${B_FIN_VP}`,
  // "Now is the time to buy that house." / "Now is the perfect time to invest."
  `\\b(?:now|today|this) (?:is|would be) (?:the|a) (?:(?:right|best|perfect|good|great|ideal|smart|wise|lucky) )?(?:time|moment) (?:for you(?: both| two)? )?to (?:${B_FIN_VP}|${B_FIN_BARE})`,
];

const BLOCK_RULES: Template[] = [
  ...rules("directive", BLOCK_DIRECTIVE),
  ...rules("directive", BLOCK_DIRECTIVE_STARTING, { starting: true }),
  ...rules("prediction", BLOCK_PREDICTION),
  ...rules("score", BLOCK_SCORE),
  ...rules("diagnosis", BLOCK_DIAGNOSIS),
  ...rules("diagnosis", [BLOCK_DIAGNOSIS_NAME], { caseSensitive: true }),
  ...rules("reproductive", BLOCK_REPRODUCTIVE),
  ...rules("medication", BLOCK_MEDICATION),
  ...rules("financial", BLOCK_FINANCIAL),
];

// ---------------------------------------------------------------------------
// What excuses a block-tier trigger. An excuse needs scope: it must be about
// this trigger, not about something else in the sentence.
//   - A negator attached to the trigger's own verb ("will not", "is not", "never
//     will") is not an excuse at all: those forms are simply not in the patterns.
//   - A negator elsewhere never excuses: not in a coordinated sibling ("He
//     doesn't love you and he will cheat."), not in a condition ("If he doesn't
//     change you will break up.").
//   - A trigger that is the complement of a frame that does not assert it is
//     excused: whether / if, first-person refusal, "nothing here says", "does not
//     mean", "no evidence that", "it would be unfair to claim that", a claim the
//     person reported, a noun frame ("the fear that ..."). All of these are
//     found by `limited` (the cue, and the words that must link it to the
//     trigger) or by `framed` (reported speech), never by distance alone.
//   - A frame never excuses a trigger the same sentence endorses.
// ---------------------------------------------------------------------------

/** "Your compatibility is not 85%": the negator is part of the match. */
const NEGATED_IN_MATCH = /\b(?:not|never|nor|no)\b|n't\b/i;
/** "It's not a 7/10": a negator right before the number. */
/** "No couple is 100% compatible": a negated subject, then its copula, then the number. */
const NEGATED_COPULA =
  /(?:^|[\s(])(?:no|nobody|nothing|never|not)\b(?: [\w']+){0,3}? (?:is|are|was|were|can be|could be|will be|would be|has ever been|ever is) (?:(?:ever|even|quite|really|exactly|just) )?$/i;
const NEGATED_BEFORE_NUMBER =
  /(?:^|[\s(])(?:not|never|nor|no|\w+n't) (?:(?:a|an|the|even|quite|really|exactly|just|anywhere near) ){0,2}(?:\d{1,3}(?:\.\d)? ?(?:\/|out of) ?\d{1,3} (?:or|nor|and) (?:an? )?){0,3}$/i;

/** "Your wife has bipolar disorder, you wrote, so ...": the person's own report, handed back. */
const OWN_REPORT_AFTER =
  /^(?:[^.;,]{0,40})?, ?(?:as )?(?:you|he|she|they) (?:said|told me|told you|wrote|mentioned|shared|noted|explained|described)\b/i;
/** An if / before / when clause that the trigger sits in. */
const CONDITIONAL_BEFORE =
  /\b(?:if|before|when|whenever|unless|once)\b[^.;,]{0,60}$/i;
/** A doctor cue after the trigger, in the same sentence: "..., talk to your doctor first." */
const DOCTOR_CUE_AFTER =
  /^[^.;]{0,60}?\b(?:talk|speak|check|consult|ask|see|call|contact|discuss)\w*\b[^.;]{0,40}?\b(?:doctor|gp|pharmacist|physician|prescriber|psychiatrist|clinician|nurse|healthcare (?:provider|professional)|health professional)\b/i;
const BLOCK_NOUN_FRAME =
  /\b(?:the|an?|your|my|his|her|their|our|this|that|any|some|every) (?:[\w'-]+ ){0,2}?(?:fears?|worr(?:y|ies)|concerns?|ideas?|myths?|rumou?rs?|notions?|anxiety|dread|beliefs?)(?: that| of| about)?(?: an?| the)?\s*$/i;
const STOP_VERB = /^(?:stop|quit|skip|come off|go off|going off)/i;

const SAID_VERB =
  "(?:said|says|say|saying|think|thinks|thought|thinking|believe|believes|believed|feel|feels|felt|fear|fears|feared|worry|worries|worried|wonder|wondered|wondering|asked|ask|asks|asking|wrote|write|writes|told|tell|tells|telling|mentioned|mention|mentions|suggested|suggests|suggest|claimed|claims|claim|heard|hear|hears|expect|expects|expected|assume|assumes|assumed|imagine|imagined|insist|insists|insisted|wish|wished|want|wants|wanted|hope|hoped|hopes|sense|sensed|suspect|suspected|reckon|warned|warns|complained|learned|noticed|decided|afraid|scared|convinced|certain|sure|call|calls|called|consider|considers|considered|deem|deems|view|views|shared|explained|disclosed|revealed|admitted|confided|described|reported|stated|added|noted|hearing|reading|read|learning|noticing|discovered|realised|realized|seen|gave|gives|give|put|puts|showed|shows|rated|rates|scored|scores|got|calculated|estimated|insisting|hinting|hinted|hints|feel like|feels like|felt like|let me know|let us know|let you know|(?:been )?(?:open|clear|honest|upfront|frank)|rate|rated|predicted|predict|predicts|feeling like|reckons|reckoned|agree|agrees|agreed|agreeing|conclude|concludes|concluded|concluding|figure|figures|figured|vote|votes|voted|maintain|maintains|maintained)";
// A time word between the verb and the claim: "As you mentioned earlier, ...".
const SAID_TIME =
  "(?: (?:earlier|before|already|yourself|again|once|recently|today|yesterday|just now|now|lately|a while ago|the other day|last (?:week|month|year|time|night)|a few (?:days|weeks|months) ago))*";
/** A saying or thinking verb right before the trigger, with its subject words in front. */
const REPORT_TAIL = new RegExp(
  // The saying verb, who it is said to, what is to be said, and the subject of
  // the claim ("... tells you that you are 90% compatible": the trigger starts at 90%).
  `((?:[\\w'-]+ ){0,5})(?:(?:told|tell|tells|telling|asked|ask|asks|asking|warned|warns) [\\w'-]+|(?:gave|gives|give|put|puts|rated|rates|rate|scored|scores|showed|shows)(?: [\\w'-]+){1,3}|${SAID_VERB}(?: (?:me|you|us|him|her|them|my|your))?)${SAID_TIME}(?: (?:from|by|online|on|via)(?: [\\w'-]+){0,3})?(?: to (?:confirm|say|tell|agree|admit|predict|promise|assure|guarantee))?(?: (?:you|he|she|they|it)(?:'re| are| is))?(?: (?:that|whether|if))?(?<bridge> (?:(?:an?|the|your|this|that) )?[\\w' -]{1,30}? (?:means|mean|shows|show|proves|prove|indicates|indicate) (?:that )?)?,?(?: (?:you|you two|he|she|they|it|the two of you)(?:'re| are| is| were| was|'s)?(?: (?:about|around|roughly|nearly|almost))?)?(?: (?:should|must|need to|needs to|have to|ought to|will|would|could|can|may|might|going to|want to|wants to|plan to|plan on|wanna))?(?: (?:at|an?|the|only|just|about|around|roughly|nearly|almost|score of|rating of|(?:[\\w-]+ )?(?:score|rating|percentage|grade) of|to))*\\s*$`,
  "i",
);
const FIRST_PERSON = new Set([
  "i",
  "we",
  "i'd",
  "i'll",
  "i'm",
  "i've",
  "we'd",
  "we'll",
  "we're",
  "we've",
  "me",
  // "My sense is that ...", "our view": the speaker's own possessive.
  "my",
  "our",
  // "That said, ...": an idiom, not a report.
  "that",
  "this",
]);
/** Words between a subject and its saying verb that say nothing about who speaks. */
const BEFORE_VERB = new Set([
  "would",
  "will",
  "might",
  "could",
  "can",
  "do",
  "did",
  "does",
  "really",
  "honestly",
  "just",
  "also",
  "still",
  "always",
  "often",
  "only",
  "never",
  "definitely",
  "probably",
  "keeps",
  "keep",
  "kept",
  "has",
  "have",
  "had",
  "is",
  "are",
  "was",
  "were",
  "been",
  "being",
  "may",
  "must",
  "should",
  "even",
  "all",
  "both",
  "of",
  "to",
  "about",
  "thinking",
  "considering",
  "planning",
  "going",
]);
/** Speakers whose words are the assistant's own when it repeats them. */
const GENERIC_SPEAKERS = new Set([
  "astrologers",
  "astrologer",
  "astrology",
  "people",
  "others",
  "some",
  "many",
  "most",
  "they",
  "tradition",
  "folklore",
  "apps",
  "websites",
  "sources",
  "horoscopes",
  "experts",
  "online",
  "books",
  "stars",
  "chart",
  "charts",
  "reading",
  "readings",
  "texts",
  "lore",
  "everyone",
  // A source the sentence reports, not the person: its number is only echoed
  // when the sentence or the next one sets it aside.
  "app",
  "site",
  "website",
  "quiz",
  "test",
  "calculator",
  "tool",
  "platform",
  "someone",
  "somebody",
  "reader",
]);
/**
 * Sources whose number or claim the sentence only reports: an app, a quiz, a site,
 * a forum, someone online. Reported by the assistant, it is excused unless the
 * assistant then adopts it, the rule used for the person's own words. (Astrologers,
 * people and the chart keep the stricter rule: a bare "many astrologers would say
 * it is doomed" is the assistant's own forecast.)
 */
const SOURCE_SPEAKERS = new Set([
  "app",
  "apps",
  "site",
  "sites",
  "website",
  "websites",
  "quiz",
  "quizzes",
  "test",
  "tests",
  "calculator",
  "tool",
  "platform",
  "reader",
  "forum",
  "article",
  "post",
  "video",
  "blog",
  "influencer",
  "someone",
  "somebody",
  "horoscope",
]);
/** Words that put a saying verb on the person's side: they, or people around them. */
const USER_MARKERS = new Set([
  "you",
  "your",
  "you've",
  "you're",
  "you'd",
  "friend",
  "friends",
  "friend's",
  "sister",
  "brother",
  "mother",
  "mom",
  "mum",
  "dad",
  "father",
  "aunt",
  "uncle",
  "cousin",
  "family",
  "parents",
  "coworker",
  "colleague",
  "boss",
  "ex",
  "therapist",
  "doctor",
  "counsellor",
  "counselor",
  "partner",
  "husband",
  "wife",
  "boyfriend",
  "girlfriend",
  "he",
  "she",
]);

/** Who says it, from the words in front of a saying verb. */
function speakerOf(
  subject: string,
): "assistant" | "user" | "source" | "generic" {
  const words = subject.trim().toLowerCase().split(" ").filter(Boolean);
  while (words.length > 0 && BEFORE_VERB.has(words[words.length - 1]))
    words.pop();
  const last = words[words.length - 1];
  // No subject, or an imperative ("Don't worry you will ..."): not a report.
  if (
    last === undefined ||
    FIRST_PERSON.has(last) ||
    // "My app puts you at 52%": the assistant's own source is its own claim.
    words.includes("my") ||
    words.includes("our") ||
    last.endsWith("n't") ||
    last === "please" ||
    last === "let's" ||
    last === "not"
  )
    return "assistant";
  // "You mentioned an app said ...": the person is the one reporting.
  if (words.some((w) => w === "you" || w === "you've" || w === "you're"))
    return "user";
  if (
    SOURCE_SPEAKERS.has(last) ||
    (last === "online" &&
      /^(?:someone|somebody|anyone)$/.test(words[words.length - 2] ?? ""))
  )
    return "source";
  if (GENERIC_SPEAKERS.has(last)) return "generic";
  // A supplied name is a person around the user too.
  if (
    last === "who" ||
    words.some((w) => USER_MARKERS.has(w) || w.startsWith("zzp"))
  )
    return "user";
  return "generic";
}

/** A following sentence that sets a reported claim aside: "I'd gently set that aside." */
const REJECTS =
  /\b(?:not|never|no|nothing|cannot|made up|meaningless|worthless|pointless|invented|set (?:that|this|it|those|these) aside|grain of salt|pinch of salt|ignore|disregard|forget)\b|\w+n't\b/i;
/** "..., but I don't read it that way": the sentence goes on to push the claim away. */
const DISTANCED_AFTER =
  /^[^.]{0,100}?\b(?:but|however|though|yet|although|while|whereas)\b(?: [\w']+){0,8}? (?:not|never|no|cannot|disagree|doubt|myth|nonsense|untrue|unfounded|overstated|oversimplified|rather|instead|nothing|meaningless|worthless|pointless|invented|\w+n't)\b/i;

/**
 * A claim the person made or someone around them made, handed back ("You said
 * your friends think you should leave him"), or a claim attributed to others
 * that the sentence then rejects. Never the assistant's own words, and never a
 * claim the sentence goes on to endorse.
 */
function framed(
  before: string,
  after: string,
  next: string,
  category: PolicyCategory,
): boolean {
  const endorsed =
    ENDORSED.test(after.slice(0, 80)) || ENDORSED.test(next.slice(0, 80));
  if (BLOCK_NOUN_FRAME.test(before)) return !endorsed;
  const m = REPORT_TAIL.exec(before);
  if (!m || endorsed) return false;
  // "As you said, you should leave him.": the assistant carries on in its own voice.
  if (
    (category === "directive" || category === "prediction") &&
    m[0].trimEnd().endsWith(",")
  )
    return false;
  const speaker = speakerOf(m[1]);
  if (speaker === "assistant") return false;
  if (speaker === "user" || speaker === "source") return true;
  // "Some say Venus in your chart means you'll ...": the claim is passed on,
  // through a bridge that names its ground, and the assistant has not adopted it.
  if (m.groups?.bridge) return true;
  // A claim from a general authority ("astrologers say ...") passes only when
  // the sentence, or the next one, sets it aside.
  return DISTANCED_AFTER.test(after) || REJECTS.test(next.slice(0, 160));
}

function blockExcused({
  rule,
  plain,
  end,
  text,
  before,
  next,
  userQuote,
}: Ctx): boolean {
  const { category } = rule;
  if (DOUBT_DIRECT.test(before)) return true;
  // The person's own quoted words, handed back, unless the assistant adopts them.
  if (
    userQuote &&
    !ENDORSED.test(plain.slice(end, end + 80)) &&
    !ENDORSED.test(next.slice(0, 80))
  )
    return true;
  if (limited(before, category !== "directive" && category !== "prediction"))
    return true;
  const after = plain.slice(end, end + 120);
  if (framed(before, after, next, category)) return true;
  switch (category) {
    case "score":
      return (
        NEGATED_IN_MATCH.test(text) ||
        NEGATED_BEFORE_NUMBER.test(before) ||
        NEGATED_COPULA.test(before)
      );
    case "diagnosis":
    case "reproductive":
      return (
        OWN_REPORT_AFTER.test(after.slice(0, 40)) &&
        !ENDORSED.test(after.slice(0, 120))
      );
    case "medication":
      return (
        DOCTOR_BEFORE.test(before) ||
        PRESCRIBED_AFTER.test(plain.slice(end, end + 60)) ||
        (STOP_VERB.test(text) && NEGATION_NEAR.test(before)) ||
        // "If you skip your metformin, talk to your doctor first."
        (CONDITIONAL_BEFORE.test(before) &&
          DOCTOR_CUE_AFTER.test(plain.slice(end, end + 100)))
      );
    case "financial":
      return (
        NEGATED_WORDS.test(text) &&
        ASTRO_BASIS_AFTER.test(plain.slice(end, end + 110))
      );
    default:
      return false;
  }
}

const buildBlock = (names: string) =>
  buildEngine(BLOCK_RULES, blockExcused, false, names);

// Asides that sit between "you" and "should" or between "should" and the verb.
// An aside that opens with a pronoun is a clause of its own ("No chart can say
// it, I can, you should leave him"), not an interjection, and is left in.
// The fixed hedges "I think", "I'm afraid", "I'd say" are interjections.
const PRONOUN_LED =
  "(?:i|we|you|he|she|they|it|there)\\b(?! (?:think|fear|suppose|guess|believe|reckon|expect|would say)\\b)(?!'m (?:afraid|sure|certain)\\b)(?!'d say\\b)";
const ASIDES = [
  new RegExp(`\\s*\\((?!\\s?${PRONOUN_LED})[^()]{0,80}\\)`, "gi"),
  new RegExp(`,(?! ${PRONOUN_LED})(?: [\\w'%-]+){1,6},`, "gi"),
  new RegExp(
    `\\s[—–-]{1,2}\\s(?!${PRONOUN_LED})(?:[\\w'%,]+ ){1,6}[—–-]{1,2}\\s`,
    "gi",
  ),
];

/** The sentence without parenthetical and comma-bracketed asides. */
function withoutAsides(sentence: string): string {
  let out = sentence;
  for (const re of ASIDES) out = out.replace(re, " ");
  return out.replace(/ {2,}/g, " ").trim();
}

/**
 * Block-tier findings: the sentence as written, and without its asides.
 *
 * A directive is read through its asides ("You should, honestly, leave him."),
 * and the reading without asides decides: when it finds no directive, a
 * directive the plain reading found stays only if its words sat inside the
 * removed aside ("(you should leave him)"). Elsewhere an aside can be the very
 * thing that excuses a claim ("..., you wrote, so ..."), so only advice is read
 * that way.
 */
function blockHits(
  sentence: string,
  bare: string,
  block: Engine,
  next: string,
): Hit[] {
  const plain = scan(sentence, "", block, next);
  if (bare === sentence) return plain;
  const stripped = scan(bare, "", block, next);
  const strippedCategories = new Set(stripped.map((h) => h.category));
  const bareLower = bare.toLowerCase();
  // The reading without asides decides: a finding stays only if it holds there
  // too, or if its words sat inside the removed aside ("(you should leave him)").
  const found = plain.filter(
    (h) =>
      strippedCategories.has(h.category) ||
      !bareLower.includes(h.text.toLowerCase()),
  );
  // Advice and forecasts are also read through their asides ("You two will,
  // sadly, break up."): the reading without asides may add them.
  for (const category of ["directive", "prediction"] as const) {
    const added = stripped.find((h) => h.category === category);
    if (added && !found.some((h) => h.category === category)) found.push(added);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Names and the engines built for them
// ---------------------------------------------------------------------------

export interface PolicyOptions {
  /**
   * Display names of the people the answer is about (the two names the prompt
   * uses). Matched as whole words, as written, in capitals or capitalised (never
   * in other cases, so "will" is not "Will"), as a person where "him",
   * "her" or "your partner" would stand ("You should leave Sam.", "Sam will
   * cheat.", "Sam is a narcissist."). At most MAX_NAMES are read, each cut to
   * MAX_NAME_LENGTH characters. A name that is a month, a season or a planet
   * is the calendar word or the planet before a calendar predicate ("Summer
   * will end soon.") and the person otherwise.
   */
  names?: string[];
}

const MAX_NAMES = 6;
const MAX_NAME_LENGTH = 40;
/** Words that are never a name, so a placeholder like "You" cannot match everywhere. */
const NOT_NAMES = new Set([
  "you",
  "your",
  "yours",
  "yourself",
  "partner",
  "partner a",
  "partner b",
  "me",
  "my",
  "mine",
  "myself",
  "we",
  "us",
  "our",
  "he",
  "him",
  "his",
  "she",
  "her",
  "hers",
  "they",
  "them",
  "their",
  "it",
  "its",
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "not",
  "no",
  "yes",
  "who",
  "this",
  "that",
  "husband",
  "wife",
  "boyfriend",
  "girlfriend",
  "spouse",
  "ex",
]);

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A letter, a mark (the vowel signs of Sinhala and Tamil are marks), a digit,
// an underscore or an apostrophe continues a name. The u flag is used for this
// one small expression only; the rule patterns stay ASCII-word based.
const NAME_EDGE = "[\\p{L}\\p{M}\\p{N}_']";

/**
 * Words that are also given names or ordinary words the patterns are built on.
 * Written in lower case, or at the start of a sentence before a pronoun, they
 * are the ordinary word ("You two will break up.", "Will you two break up?"),
 * never the person.
 */
const COMMON_WORD_NAMES = new Set([
  "will",
  "may",
  "can",
  "must",
  "shall",
  "should",
  "might",
  "would",
  "could",
  "need",
  "hope",
  "faith",
  "grace",
  "joy",
  "sunny",
  "rose",
  "summer",
  "leave",
  "love",
  "stop",
  "mark",
  "bill",
  "art",
  "pat",
  "sue",
  "rob",
  "dawn",
  "sun",
  "moon",
  "mercury",
  "venus",
  "mars",
  "jupiter",
  "saturn",
  "ray",
  "bob",
  "pearl",
  "ivy",
  "lily",
  "january",
  "february",
  "march",
  "april",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "autumn",
  "winter",
  "spring",
  "uranus",
  "neptune",
  "pluto",
  "chance",
  "prince",
  "major",
]);

/**
 * Names that are also a season, a month, a planet, the Sun or the Moon. Written
 * with a calendar or celestial predicate after them ("Summer will end soon.",
 * "Mercury will go retrograde.") they are the season or the planet, never the
 * person, so a forecast about the calendar is not a forecast about the couple.
 * With any other predicate ("Summer will leave you.", "Summer will cheat.") they
 * are the person. The predicates are a fixed list, not a guess.
 */
const CALENDAR_NAMES = new Set([
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "summer",
  "autumn",
  "winter",
  "spring",
  "sun",
  "moon",
  "mercury",
  "venus",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
]);
const CALENDAR_AUX =
  "(?:(?:will|won't|'ll|would|might|may|could|should|must|shall|does|did|is|was|has|had|are|were)\\s+)?";
const CALENDAR_ADV =
  "(?:(?:soon|finally|always|never|also|just|almost|quickly|slowly|eventually|officially|really|only|then|still|not)\\s+){0,2}";
const CALENDAR_PREDICATE = new RegExp(
  `^\\s+${CALENDAR_AUX}${CALENDAR_ADV}(?:` +
    [
      // be over, be here, be gone, be upon us, be short ...
      "(?:be\\s+)?(?:over|here|gone|back|upon us|ending|short|long|hot|warm|cold|mild|wet|dry|cooler|warmer)(?!\\s+(?:you|him|her|them)\\b)",
      "be\\s+(?:coming to an end|a (?:long|short|hot|warm|cold|mild|wet|dry) \\w+)",
      // end soon, end with a full moon; not "end badly" or "end in tears"
      "end(?:s|ed)?(?=\\s+(?:soon|shortly|early|late|earlier|later|next|before|after|by|on|at|with|and|but)\\b|\\s*(?:$|[,.;!?]))",
      "(?:come|comes|came)\\s+(?:to an end|around|soon|early|late|next)",
      "(?:finish|finishes|finished|arrive|arrives|arrived|start|starts|started|begin|begins|began|fade|fades|faded|pass|passes|passed|rise|rises|rose|set|sets|appear|appears|appeared|shine|shines|shone|enter|enters|entered|transit|transits)\\b(?!\\s+(?:you|him|her|them)\\b)",
      "(?:turn|turns|turned|go|goes|going|went)\\s+(?:retrograde|direct)",
      "(?:station|stations|stationed)\\s+(?:retrograde|direct)",
      "retrograde",
    ].join("|") +
    `)`,
  "i",
);

/** The ways a supplied name may be written in the text, longest first. */
function cleanNames(names: readonly string[] | undefined): string[] {
  if (!names || names.length === 0) return [];
  const found = new Set<string>();
  const add = (form: string) => {
    if (form.length >= 2) found.add(form);
  };
  for (const raw of names.slice(0, MAX_NAMES)) {
    if (typeof raw !== "string") continue;
    const name = raw
      .normalize("NFKC")
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[\u0000-\u001f\u007f-\u009f​-‍⁠﻿­]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_NAME_LENGTH)
      .trim();
    for (const candidate of [name, name.split(" ")[0]]) {
      const lower = candidate.toLowerCase();
      if (candidate.length < 2 || NOT_NAMES.has(lower)) continue;
      const capitalised = lower[0].toUpperCase() + lower.slice(1);
      if (COMMON_WORD_NAMES.has(lower)) {
        // Only capitalised: "Will" is a person, "will" and "WILL" never are.
        add(capitalised);
        continue;
      }
      // As written, in capitals ("SAM WILL CHEAT"), and capitalised, whatever
      // case it was given in ("SAM" is also found as "Sam").
      add(candidate);
      add(candidate.toUpperCase());
      add(capitalised);
    }
  }
  // The longest first, so "Mary Ann" is replaced whole and not as "Mary".
  return [...found].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
}

// The expression for a set of names: a plain alternation of escaped literals
// (no repetition, so it cannot backtrack) between two edge tests, matched case
// by case as written. A name followed by "'s" and a verb or article ("Sam's going
// to cheat") is the name; "Sam's keys" is not. Building one costs microseconds,
// and the last 256 sets are kept (least recently used out).
const NAME_CONTRACTION =
  "(?='s (?:going to|an?|the|been|not|so|very|really|definitely|certainly|clearly|probably|always|never|still|just|also|bipolar|autistic|depressed|narcissistic|clinically)\\b)";
const replacers = new Map<string, RegExp>();
const MAX_CACHED_NAME_SETS = 256;

/** An expression that finds the supplied names as whole words, or null. */
function nameReplacer(names: readonly string[] | undefined): RegExp | null {
  const list = cleanNames(names);
  if (list.length === 0) return null;
  const key = list.join("\u0001");
  const cached = replacers.get(key);
  if (cached) {
    replacers.delete(key);
    replacers.set(key, cached);
    return cached;
  }
  const built = new RegExp(
    `(?<!${NAME_EDGE})(?:${list.map(escapeRegExp).join("|")})(?:(?!${NAME_EDGE})|${NAME_CONTRACTION})`,
    "gu",
  );
  replacers.set(key, built);
  if (replacers.size > MAX_CACHED_NAME_SETS)
    replacers.delete(replacers.keys().next().value as string);
  return built;
}

const SENTENCE_START = /(?:^|[.!?\n:;]\s*|["“(]\s*)$/;
const PRONOUN_AFTER =
  /^\s+(?:you|we|i|they|he|she|it|the|this|that|there|not|never|please|just|also)\b/i;

/**
 * The text with each supplied name replaced by a token that stands for it, and
 * the names it replaced (the token's number is an index into them). A name that
 * is also an ordinary word is left alone at the start of a sentence before a
 * pronoun ("Will you two break up?").
 */
function applyNames(
  text: string,
  names: readonly string[] | undefined,
): { text: string; originals: string[] } {
  const re = nameReplacer(names);
  if (!re) return { text, originals: [] };
  const originals: string[] = [];
  const replaced = text.replace(re, (match, ...rest) => {
    const offset = rest[rest.length - 2] as number;
    if (
      COMMON_WORD_NAMES.has(match.toLowerCase()) &&
      SENTENCE_START.test(text.slice(Math.max(0, offset - 3), offset)) &&
      PRONOUN_AFTER.test(
        text.slice(offset + match.length, offset + match.length + 14),
      )
    )
      return match;
    // "Summer will end soon.": the season, not a person named Summer.
    if (
      CALENDAR_NAMES.has(match.toLowerCase()) &&
      CALENDAR_PREDICATE.test(
        text.slice(offset + match.length, offset + match.length + 60),
      )
    )
      return match;
    let index = originals.indexOf(match);
    if (index < 0) index = originals.push(match) - 1;
    return nameToken(index);
  });
  return { text: replaced, originals };
}

/** Puts the names back into a finding's text. */
function restoreNames(text: string, originals: readonly string[]): string {
  if (originals.length === 0) return text;
  return text.replace(
    TOKEN_IN_TEXT,
    (token, digits: string) => originals[Number(digits)] ?? token,
  );
}

interface Engines {
  block: Engine;
  broad: Engine;
}

let engines: Engines | undefined;
/** The two engines, built once, on first use. */
function engineSet(): Engines {
  engines ??= {
    block: buildBlock(NAME_PATTERN),
    broad: buildBroad(NAME_PATTERN),
  };
  return engines;
}
// ---------------------------------------------------------------------------
// A question and its answer (flag tier)
// ---------------------------------------------------------------------------

// "Should you leave him? Yes."
const QUESTION_LEAD =
  /^[-*\d.) ]*(?:what|why|how|when|where|who|whom|whose|which|do|does|did|can|could|would|will|is|are|am|was|were|have|has|had|should|shall|might|may|whether|if|on a scale)\b/i;
const isQuestion = (s: string) => /\?["”')]*$/.test(s) && QUESTION_LEAD.test(s);

const SUBJECT =
  "(?:you(?: two| both)?|i|we|he|she|they|it|this (?:relationship|marriage|pairing|match|bond)|the (?:relationship|marriage)|your (?:relationship|marriage|partner|husband|wife|boyfriend|girlfriend|ex|bond)|our (?:relationship|marriage|bond))";
const INVERT = new RegExp(
  `^[-*\\d.) ]*(should|will|is|are|must)\\s+(${SUBJECT})\\s+(\\S.*)$`,
  "i",
);
const MAP_SUBJECT: Record<string, string> = { i: "you", we: "you two" };

/** "Should you leave him?" as "you should leave him". Null for other questions. */
function declarative(question: string): string | null {
  // Trim the question marks and closing quotes by hand: a regex that backtracks
  // over a long run of them is quadratic.
  let stop = question.length;
  while (stop > 0 && "?\"”')".includes(question[stop - 1])) stop -= 1;
  const m = INVERT.exec(question.slice(0, stop).trimEnd());
  if (!m) return null;
  const subject = m[2].toLowerCase();
  return `${MAP_SUBJECT[subject] ?? subject} ${m[1].toLowerCase()} ${m[3]}`;
}

const ANSWER_YES =
  /^(?:(?:and|but|well|so|oh|ah|sadly|unfortunately|honestly|truthfully|frankly|realistically|sure|simply|plainly)[,:]?\s+)*(?:yes|yeah|yep|yup|definitely|absolutely|certainly|probably|likely|most likely|i think so|i'd say so|i would say so|of course|without a doubt)(?![\w']| (?:not|never|no|and no|or no)\b)/i;
const ANSWER_NO =
  /^(?:(?:and|but|well|so|oh|ah|sadly|honestly|truthfully|frankly|simply)[,:]?\s+)*(?:no|nope|not at all|never)(?=[,.!;:]|$)/i;

// ---------------------------------------------------------------------------
// The two public functions
// ---------------------------------------------------------------------------

const QUOTE_MARKS = /["“”]/g;

function scanText(
  text: string,
  withFlags: boolean,
  options: PolicyOptions | undefined,
): { violations: PolicyViolation[]; flags: PolicyViolation[] } {
  const { block, broad } = engineSet();
  const violations = new Map<string, PolicyViolation>();
  const flags = new Map<string, PolicyViolation>();
  const add = (
    into: Map<string, PolicyViolation>,
    sentence: string,
    hit: Hit,
  ) => {
    const key = `${hit.category}|${sentence.toLowerCase()}`;
    if (!into.has(key)) into.set(key, hit);
  };
  let question = "";
  let asked = "";
  // A supplied name becomes a token the patterns know.
  const { text: named, originals } = applyNames(
    normalize(text),
    options?.names,
  );
  // Whole sentences first, so what follows a semicolon still counts as what
  // follows ("Let that go; it isn't meaningful."), then their parts. All of it is
  // built backwards and cut short, so the work stays linear.
  const whole = named.split(SENTENCE_END).map((s) => s.trim());
  const wholeNext: string[] = new Array(whole.length);
  let upcoming = "";
  for (let k = whole.length - 1; k >= 0; k--) {
    wholeNext[k] = upcoming;
    if (whole[k]) upcoming = whole[k];
  }
  const units: { sentence: string; next: string }[] = [];
  whole.forEach((full, k) => {
    const parts = full.split(/; ?/).map((p) => p.trim());
    const rest: string[] = new Array(parts.length);
    let tail = "";
    for (let j = parts.length - 1; j >= 0; j--) {
      rest[j] = tail;
      if (parts[j]) tail = `${parts[j]}; ${tail}`.slice(0, 200);
    }
    parts.forEach((sentence, j) =>
      units.push({
        sentence,
        next: rest[j] ? `${rest[j]} ${wholeNext[k]}` : wholeNext[k],
      }),
    );
  });
  for (const { sentence, next } of units) {
    if (!sentence) continue;
    if (isQuestion(sentence)) {
      question = sentence;
      asked = withFlags ? (declarative(sentence) ?? "") : "";
      continue;
    }
    const prior = question;
    const pending = asked;
    question = "";
    asked = "";

    const blocked = new Set<PolicyCategory>();
    const bare = withoutAsides(sentence);
    // The prefilter sees the text as the scan will: without quotation marks.
    const unquoted = sentence.replace(QUOTE_MARKS, "");
    if (
      block.prefilter.test(unquoted) ||
      block.prefilter.test(bare.replace(QUOTE_MARKS, ""))
    )
      for (const hit of blockHits(sentence, bare, block, next)) {
        add(violations, sentence, hit);
        blocked.add(hit.category);
      }
    if (!withFlags) continue;

    // The flag tier never repeats what the block tier already reports.
    const flag = (about: string, hit: Hit) => {
      if (about === sentence && blocked.has(hit.category)) return;
      add(flags, about, hit);
    };
    if (pending && !HAS_LIMITATION.test(sentence)) {
      const yes = ANSWER_YES.test(sentence);
      const no = !yes && ANSWER_NO.test(sentence);
      if (yes || no)
        for (const hit of scan(pending, "", broad))
          if (yes || hit.category === "directive") flag(pending, hit);
    }
    if (!broad.prefilter.test(unquoted) && !prior) continue;
    for (const hit of scan(sentence, prior, broad)) flag(sentence, hit);
  }
  const restore = (hit: PolicyViolation): PolicyViolation => ({
    category: hit.category,
    text: restoreNames(hit.text, originals),
  });
  return {
    violations: [...violations.values()].map(restore),
    flags: [...flags.values()].map(restore),
  };
}

/**
 * The violations that block an answer: advice, verdicts and instructions in a
 * few plain shapes (see the block tier notes above). Empty when the answer is
 * clean. Case-insensitive, sentence by sentence and clause by clause.
 */
export function findPolicyViolations(
  text: string,
  options?: PolicyOptions,
): PolicyViolation[] {
  return scanText(text, false, options).violations;
}

/**
 * Everything broader that the block tier leaves alone: soft advice, trust and
 * forgive and stay, soft predictions and diagnoses, bare score nouns, a question
 * answered by a plain yes. It never blocks anything; it is for people reading
 * the live eval, and for monitoring. Findings the block tier already reports
 * are left out.
 */
export function findPolicyFlags(
  text: string,
  options?: PolicyOptions,
): PolicyViolation[] {
  return scanText(text, true, options).flags;
}

/**
 * How many findings each category has: the only form in which flag-tier results
 * are logged. Never the matched text, never a name.
 */
export function countCategories(
  findings: readonly PolicyViolation[],
): Partial<Record<PolicyCategory, number>> {
  const counts: Partial<Record<PolicyCategory, number>> = {};
  for (const { category } of findings)
    counts[category] = (counts[category] ?? 0) + 1;
  return counts;
}

// Inputs that together touch every category, the excuse paths, the quote and
// question paths and a clean paragraph, so that every lazily compiled pattern
// is built before the first real answer is checked.
const WARM_TEXTS = [
  "You should leave him. Sam will most likely cheat. You are 80% compatible. Priya has ADHD. Stop taking your pills. You are pregnant. You should invest in stocks. This relationship is doomed. Don't leave him. Leave him \u2014 now. You will, sadly, break up. An app gave you a 34% match. I'm not saying you should leave Sam. As you said, he has ADHD.",
  "I can't tell you whether you should leave him. Should you leave him? Yes. \u201cYou should leave him,\u201d she said. Take your medication as prescribed. Talk to your doctor first.",
  "A calm, ordinary paragraph about the week ahead. You may want to talk about how you each handle conflict, and what a good evening looks like for both of you.",
];

/**
 * Runs both tiers once on fixed inputs. The patterns are large and V8 compiles
 * them on first use (about a second and a half in all), so a server calls this
 * at start-up and the tests call it before their first case; after it every
 * call is a few milliseconds.
 */
export function warmPolicyEngines(): void {
  const options = { names: ["Sam", "Priya"] };
  for (const text of WARM_TEXTS) {
    findPolicyViolations(text, options);
    findPolicyFlags(text, options);
  }
}
