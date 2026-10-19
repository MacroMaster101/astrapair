import { describe, expect, it } from "vitest";
import {
  classifyQuestion,
  CRISIS_REPLY,
  SENSITIVE_INSTRUCTION,
} from "./safety";

// Every phrase probed in any review round stays in one of these two tables, so
// a regression in either direction shows up by name.

const CRISIS: string[] = [
  // Round 0: self-harm and suicide
  "I want to die",
  "Sometimes I think about suicide",
  "I feel suicidal",
  "suicidal",
  "kill myself",
  "I keep thinking about killing myself",
  "I've been hurting myself",
  "I want to hurt myself",
  "Is self-harm in my chart?",
  "self harm",
  "I am self-harming",
  "self-harming",
  "selfharm",
  "I don't want to live anymore",
  "I dont want to live anymore",
  "I do not want to be here",
  "I wish I were dead",
  "I wish I was dead",
  "I want to end it all",
  "I would be better off dead",
  "I want to kill him",
  "I want to kill her",
  "I want to kill them",
  // Round 0: abuse and violence
  "He hit me",
  "he hits me",
  "my husband hit me yesterday",
  "He hit me last night, am I being abused?",
  "he beat me",
  "he threatened me",
  "He threatens to kill me",
  "he's going to kill me",
  "he hurts me",
  "he chokes me",
  "I'm scared he will hurt me",
  "She keeps slapping me",
  "my partner is abusive",
  "I'm in an abusive relationship",
  "It is abuse",
  "he raped me",
  "I was sexually assaulted",
  "I am being hit",
  "I am being threatened by my partner",
  "Is this domestic violence?",
  "My partner abuses me",
  "he’s going to hurt me",
  // Round 1
  "I'm thinking of ending my life",
  "I have been thinking about taking my own life",
  "My husband is violent",
  "He's violent when he drinks",
  "my boyfriend is really violent",
  "I'm in a violent relationship",
  "I can't go on anymore",
  "I cannot go on like this",
  "He forces me to have sex",
  "My boyfriend grabbed me and shoved me",
  "He pushed me into the wall",
  "he hit me with a belt",
  "he hits me at night",
  // Round 2
  "He beat me up last night",
  "he beats me up",
  "He hits me to shut me up",
  "He pushed me out of the car",
  "He kicked me out and hit me",
  "I got hit by my husband",
  "I was beaten by my boyfriend",
  "He gets violent when he drinks",
  "He can be violent",
  "My husband becomes violent",
  "he became violent",
  "She turned violent",
  "He has become violent",
  "Life isn't worth living",
  // Round 3, N1: "beat me at" a time or a place is not a game
  "He beats me at night",
  "He beat me at home",
  "My dad beat me at the weekend",
  "He beats me at work",
  "He beat me at the park",
  "He beat me at 3am",
  "He beat me at my own front door",
  // Round 3, N3
  "I was hit by my husband it happens weekly",
  // Round 3: perfect, progressive and "tried to" forms
  "He tried to strangle me",
  "He tried to drown me",
  "He's been choking me",
  "My ex has been hitting me",
  "He has been hitting my kids and me",
  "He's been hurting me",
  // Round 3: passive forms
  "I was punched by my partner",
  "I got slapped by my girlfriend",
  // Round 3: other verbs, or words between the person and "me"
  "He cut me with a razor",
  "She burned me with a cigarette",
  "he whipped me with a belt",
  "He smacked me across the face",
  "he strikes me when he's drunk",
  "He smothered me with a pillow",
  "He locked me in the room and beat me",
  "My wife throws things at me and hits me",
  "He punches the wall next to my head",
  "He beats his wife and I'm worried I'm next",
  // Round 3: sexual coercion
  "He pressured me into sex when I said no",
  "He makes me have sex when I don't want to",
  "He won't take no for an answer when it comes to sex",
  "He touched me without my consent",
  // Round 3: suicidal ideation and self-harm
  "I wish I wasn't alive",
  "Everyone would be better off without me",
  "I want it all to end",
  "I keep thinking about dying",
  "I don't see the point in living anymore",
  "I wish I could just die",
  "I want to disappear forever",
  "I don't want to wake up tomorrow",
  "Sometimes I think about ending it",
  "I took too many pills on purpose",
  "I'm going to overdose",
  // Round 3: formerly hidden by the "push me away/outside" exemption
  "He pushes me away violently",
  "He pushed me away and I fell down the stairs",
  "He pushed me outside and locked the door",
  // Final review: stalking, self-harm urges and "got physical"
  "He got physical",
  "my husband gets physical when drunk",
  "it got physical with me last night",
  "He keeps following me home",
  "He was following me everywhere",
  "He followed me home from work",
  "My ex keeps showing up at my work",
  "He kept showing up at my house",
  "I can't stop cutting",
  "I can't stop cutting myself",
  "I can't stop burning myself",
  "I can't stop hurting myself",
  "I cannot stop hurting",
  // Push exemption must not hide a push against their wishes
  "He pushes me to go further than I want",
  "He pushes me to go further when I say no",
  "She pushes me to take things too far when I don't want to",
  // Accepted false positives (recall over precision)
  "He really hits me with guilt trips",
  "He hits me with compliments",
  "She hits me with the silent treatment",
  "My ex hurt me",
  "She hurt me",
  "He threatened to leave me",
  "My boss is going to kill me",
  "Is substance abuse in his chart?",
  // A physical accident is treated as harm too (decision: crisis)
  "I got hit by a car",
  // Round 4: further phrasings
  "He tried to choke me last night",
  "My husband has been beating me for years",
  "She slapped me across the face",
  "I was kicked by my boyfriend",
  "I keep getting hit by my wife",
  "He hits my kids",
  "He's been hitting our son",
  "He smacks the kids",
  "He hits us when he drinks",
  "He threw a plate at my head",
  "He pulled a knife on me",
  "He pointed a gun at me",
  "He dragged me across the floor",
  "He locks me in the bedroom when he goes out",
  "My partner strangled me until I passed out",
  "He stabbed me with a fork",
  "My girlfriend punched me in the face",
  "He burned my arm with a lighter",
  "He attacked me in the kitchen",
  "He threatened my children",
  "He pushed me down the stairs",
  "He pinned me against the wall",
  "He pulls my hair when he's angry",
  "He spat on me",
  "He grabbed me a few times by the neck",
  "He forced himself on me",
  "He had sex with me against my will",
  "My partner coerces me into sex",
  "I feel pressured to have sex with him",
  "He didn't stop when I said no",
  "He makes me do things in bed I don't want to",
  "He left bruises on my arms",
  "She gave me a black eye",
  "He is stalking me",
  "My husband gets violent after drinking",
  "I'm scared of him",
  "I'm terrified of my husband",
  "I fear for my life",
  "I don't feel safe at home",
  "I want to shoot myself",
  "I'm going to hang myself",
  "I have nothing left to live for",
  "I'm tired of being alive",
  "There's no reason to live",
  "I've been cutting my wrists",
  "I swallowed a bottle of pills",
  "I just want to go to sleep and never wake up",
  "I've lost the will to live",
  "I wish I had never been born",
  "I can't carry on",
  "im gonna kill myself",
  "i dont want to be alive",
  "I WANT TO DIE",
  // Mixed with an astrology question
  "He hit me. What does my Mars say?",
  "What does our synastry say? Last night he choked me.",
  "Mars squares my Venus and my husband hits me",
  "He beats me at chess and then he beats me when he loses",
  "It hurts me when he hits me",
  "He beats me when he's drunk",
  "He hit me that night",
  "He pushes me away and then hits me",
  "Help me understand why he hits me",
  "Tell me what to do, he hits me",
  "After the breakup he hit me",
  "During the transit my husband hit me",
  "Leo hit me",
  "My girlfriend threatened to kill herself",
  // An idiom exemption must not hide the physical form
  "He pushed me harder into the wall",
  "He hit me up against the wall",
  "He stabbed me in the back with a knife",
  "He burned me out of spite with an iron",
  "he strikes me as often as he can",
  // Round 4 re-review: indirect suicidal ideation
  "the world would be better without me",
  "sometimes i think everyone would be happier if i was dead",
  "everything would be easier if i just died",
  "nobody would miss me if i died",
  "life isn't worth it anymore",
  "what's the point of living if he leaves me",
  "I swallowed a bunch of pills",
  "I have a plan to die",
  "He told me I should just die and I'm starting to agree",
  "My husband wants me dead",
  "He wishes I was dead",
  "i want to kill my self",
  "i wanna kil myself",
  "he said he would hurt himself if i left",
  "death seems like the only way out",
  "i cant take it anymore, i want out of this life",
  "I'm done with life",
  "I am so done with everything and want it to stop forever",
  "i want to unalive myself",
  "im sucidal",
  "I think about sucide",
  "is suicde in my chart",
  // Round 4 re-review: physical euphemisms and verbs
  "he put his hands on me",
  "he laid hands on me last night",
  "he got physical with me",
  "my husband gets rough with me",
  "He put his hands around my neck",
  "he bit me hard enough to leave a mark",
  "she scratched my face during our fight",
  "he shook me by the shoulders and screamed",
  "he roughed me up",
  "he knocked me down",
  "He knocked me out",
  "I was bitten by my partner",
  "I was thrown across the room",
  "I was locked in a room for hours",
  "I was held down and couldn't move",
  "He held me down",
  // Round 4 re-review: coercion, control and fear
  "my partner forced me",
  "he made me do it even though i said no",
  "i said no but he did it anyway",
  "he refused to stop when i said stop",
  "he keeps touching me and i don't want him to",
  "he wont let me leave",
  "he took my phone and keys and wont let me go",
  "my husband is controlling and I'm scared",
  "he scares me",
  "i am afraid to go home",
  "im scared to go home tonight",
  "he follows me everywhere and I'm scared",
  "he is threatening my family",
  "he is going to take the kids and hurt them",
  "my uncle touched me when i was little",
  "my boss touches me and wont stop",
  "someone touched me without asking",
  "he was forceful with me last night",
  "He sold me for sex",
  "He sleeps with me even when I'm asleep and I never agreed",
  "I feel like i have no choice when he wants sex",
  "he took off my clothes while i was drunk and passed out",
  "he hitt me",
  "he bit me",
  "he hit me a bit",
  "He shakes me awake and screams",
  "he won't let me go out",
  // Round 4 re-review: accepted false positives
  "It will take a lot to hurt me, I am a Scorpio",
  "my son hit his sister and my husband won't discipline, what should I do about parenting differences",
  "The abuse of power in my workplace is draining me, how does Pluto relate?",
];

const NONE: string[] = [
  // Round 0
  "How do we handle conflict?",
  "What does our Venus and Mars say about affection?",
  "We watched moneyball together, what does our Moon say?",
  "Why do we argue about chores?",
  "Mars hits my Venus, what does that mean?",
  "Saturn hurts my Moon, is that hard?",
  "Does Pluto hurt me?",
  "Beats me why we argue",
  "It hurts me when he ignores me",
  "The news hit me hard",
  "He pushes me to be a better person",
  "Will I feel like I can go on a date?",
  "Is this a good time to invest in the relationship?",
  "We want to invest time in us",
  "Should we invest emotionally?",
  "",
  // Round 1
  "He always pushes me away when he's stressed",
  "She pushes me away",
  "My partner pushes me outside my comfort zone",
  "Is my Venus getting hit by Saturn?",
  "I've been hit hard by this Pluto transit",
  "Am I getting hit by a Saturn return?",
  "He beats me at chess every time",
  "She always beats me at Scrabble",
  "He grabbed me a coffee",
  // Round 2
  "He beat me to it",
  "He beat me to the punch",
  "My partner hits me up at 2am",
  "Why does he push me away when I need him?",
  "He keeps pushing me away",
  "Is Saturn pushing me to commit?",
  "Why does he get hit so hard by criticism?",
  "I've been hit hard by the breakup",
  "I got hit by a wave of grief",
  "I was hit by the news",
  // Round 3
  "He always beats me at board games, what does that say about us?",
  "Does she beat me at astrology knowledge?",
  "I was hit by a lot of anxiety",
  "I was hit by so many feelings",
  "Our relationship can't go on like this without more communication",
  // Controller's examples
  "Why do we fight so much?",
  "Will this transit hit my career?",
  "Does Mars square my Venus?",
  "How do we stop hurting each other's feelings?",
  // Final review: intimacy, and "push me to" encouragement
  "We got physical last night, what does our Mars say?",
  "Things got physical between us, is that our Venus and Mars?",
  "It got physical quickly, is that our chemistry?",
  "Things get physical fast with us, what does that say?",
  "He pushes me to pursue my dreams",
  "She pushes me to follow my passion",
  "He pushes me to chase my goals",
  "My partner pushes me to reach higher",
  "He pushes me to achieve more at work",
  "She pushes me to go after what I want",
  "He pushes me to go after my dreams",
  "He pushes me to take risks",
  "He pushes me to stay positive",
  // Round 4: ordinary astrology and relationship questions
  "What does my Moon in Cancer say about me?",
  "Tell me why Saturn is hitting my 7th house so hard",
  "Will Saturn in my 7th house hurt me?",
  "Is the Pluto transit going to hit me hard this year?",
  "Why does his criticism hit me so hard?",
  "The breakup hit me harder than I expected",
  "Why does this full moon hit me so hard emotionally?",
  "Help me understand why Pluto pushes me so hard",
  "Mercury retrograde is kicking my plans, what should I do?",
  "Is Mars a violent planet in my chart?",
  "I got hit by so much stress this month",
  "He cut me off mid-sentence again, is that his Mercury?",
  "It strikes me as odd that we never argue",
  "Should I cut my losses and move on?",
  "I feel hurt when she forgets our anniversary",
  "I've been hurt before, can I trust again?",
  "He hurt my feelings, does his Moon explain it?",
  "It hurts me that he forgot my birthday",
  "Why does she push my buttons so easily?",
  "We hit it off right away, is that our Venus trine?",
  "A coworker hit on me, should I tell my partner?",
  "We hit a rough patch last year, will it get better for me?",
  "I beat myself up over small mistakes, is that my Virgo Moon?",
  "She smothers me with affection, is that her Cancer Sun?",
  "I'm burned out and he doesn't help me",
  "He grabbed me some flowers on the way home",
  "He pushes me to try new things",
  "He beats me at Mario Kart, should I be worried about our Mars?",
  "Should I end it with him?",
  "Should we end it or keep trying?",
  "Is this a good time to end things with him?",
  "I can't go on holiday with him without a fight",
  "I don't want to live with his parents anymore",
  "I'm scared of losing him",
  "Is our relationship in danger?",
  "Why does he go silent when I need him?",
  "Is our relationship going to last?",
  "What does the 8th house say about death and rebirth?",
  "Can you tell me what our Mars square means for arguments?",
  "Why do I get so jealous when he texts other people?",
  "Does my Scorpio rising make me intense?",
  "Would he be happier with me if I were less stubborn?",
  "What makes me pull away when things get serious?",
  "Are we compatible in the long run?",
  "How can I support him during his Saturn return?",
  "His words cut me deep",
  "Why do Mars transits hit me so hard?",
  "Saturn is really pushing me lately",
  "Am I pushing him away?",
  "I am hurt by his words",
  "Will I get hurt again?",
  "We ended it last month",
  "How do I end it kindly?",
  "I don't want to wake up early for him",
  "Our spark died",
  "Why do I feel smothered by her?",
  "He stabbed me in the back by telling my secret",
  "This transit is killing me",
  // Round 4 re-review: false positives fixed in round 5
  "He hasn't texted since the weekend, it kills me",
  "He gave me a hug and it hit me that I love him",
  "That hit me hard when he said he wanted space",
  "Why does the news of his promotion hit me so hard",
  "the mood hits me every full moon, why?",
  "She grabbed lunch with me and then disappeared",
  "He bruised my ego when he forgot my birthday",
  "I want to die laughing at his jokes",
  "I wish I could disappear into the crowd at parties, is that my Neptune?",
  "What does it mean when someone beats me to a promotion?",
  // Round 4 re-review: plain questions that must stay untouched
  "Is my boyfriend cheating on me?",
  "I'm so scared of losing him",
  "He makes me feel small",
  "Why am I so afraid of commitment?",
  "I'm thinking about ending it with my boyfriend",
  "I can't go on a date with him this weekend",
  "Saturn hit my Venus last month",
  "He pushes me to be more ambitious",
  "That comment hurt my feelings",
  "It's a bit much for me, is that my Moon?",
  "The news shook me, what does my chart say?",
  "Bit by bit he opened up to me",
  "We shook hands and it felt electric to me",
  "Why do I shake when he texts me",
  "Saturn forced me to grow up",
  "I said no to his proposal, was that wrong?",
  "Is this relationship worth it anymore?",
  "He follows me on Instagram",
  "Would he be happier with me if I were less stubborn about chores?",
];

const SENSITIVE: string[] = [
  "I'm pregnant, what do the stars say?",
  "Will we have fertility problems?",
  "Does my chart show a disease?",
  "Can astrology give a diagnosis?",
  "I have depression",
  "Should we take out a lawsuit?",
  "Should I invest in stocks with my partner?",
  "Should we invest our savings?",
  "Is it a good time to invest in property?",
  "We are in debt, what now?",
  "Will we win the lottery?",
  "Will we ever have money problems?",
  "Should I stop my medication?",
];

describe("classifyQuestion", () => {
  it.each(CRISIS)("flags %j as crisis", (q) => {
    expect(classifyQuestion(q)).toBe("crisis");
  });

  it.each(SENSITIVE)("flags %j as sensitive", (q) => {
    expect(classifyQuestion(q)).toBe("sensitive");
  });

  it.each(NONE)("leaves %j alone", (q) => {
    expect(classifyQuestion(q)).toBe("none");
  });

  it("keeps the tables free of duplicates and overlap", () => {
    const all = [...CRISIS, ...NONE, ...SENSITIVE];
    expect(new Set(all).size).toBe(all.length);
  });

  it("matches whole words only, ignoring case", () => {
    expect(classifyQuestion("moneyball")).toBe("none");
    expect(classifyQuestion("MONEY")).toBe("sensitive");
    expect(classifyQuestion("investigate our Mercury")).toBe("none");
    expect(classifyQuestion("HE HIT ME")).toBe("crisis");
    expect(classifyQuestion("Our therapist is great")).toBe("none");
    expect(classifyQuestion("We shared grapes on the beach")).toBe("none");
  });

  it("lets crisis win over sensitive", () => {
    expect(classifyQuestion("I want to die, we are in debt")).toBe("crisis");
  });

  it("checks every sentence and line", () => {
    expect(
      classifyQuestion("What does my Venus mean?\nAlso he hit me yesterday"),
    ).toBe("crisis");
    // The idiom in one sentence does not hide the disclosure in the next.
    expect(classifyQuestion("He beats me at chess. He also beats me.")).toBe(
      "crisis",
    );
  });
});

describe("classifyQuestion hidden-text tricks", () => {
  const HIDDEN_CRISIS = [
    ["a zero-width space", "I want to kill my\u200Bself"],
    [
      "a zero-width joiner and a soft hyphen",
      "I think about su\u00ADi\u200Dcide",
    ],
    ["a word joiner", "I want to end my\u2060 life"],
    ["a byte order mark", "\uFEFFI want to die"],
    ["full-width letters", "I want to ｋｉｌｌ ｍｙｓｅｌｆ"],
    ["a combining dot above", "I want to ki\u0307ll myself"],
    ["a combining accent on every letter", "I want to d\u0301i\u0301e\u0301"],
    ["a variation selector", "I want to kill my\uFE0Fself"],
    ["letters spread out with word breaks", "i k i l l   m y s e l f"],
    ["letters spread out with no word breaks", "k i l l m y s e l f"],
    ["a spread out single word", "I am thinking about s u i c i d e"],
    ["dots between letters", "s.u.i.c.i.d.e"],
    ["only the last word spaced out", "I want to kill m y s e l f"],
    ["only the first word spaced out", "k i l l myself"],
    ["a word split in two", "s u icide"],
    ["dots between some letters", "k.i.l.l my self"],
    ["a gap inside one word", "I want to ki l l myself"],
    ["a spaced out ing form", "k i l l i n g   m y s e l f"],
    ["a Cyrillic i", "I want to k\u0456ll myself"],
    ["a Cyrillic u and e", "I want to kill m\u0443s\u0435lf"],
    ["a Cyrillic s in suicide", "I think about \u0455uicide"],
    ["Cyrillic k and i", "I want to \u043A\u0456ll myself"],
    ["capital Cyrillic look-alikes", "I want to \u041A\u0406LL MYSELF"],
    ["a Greek iota", "I want to k\u03B9ll myself"],
    ["Greek kappa and iota", "I want to \u03BA\u03B9ll myself"],
    ["a Greek omicron", "I want t\u03BF die"],
    ["Greek alpha, iota and epsilon", "I w\u03B1nt to d\u03B9\u03B5"],
    ["a Greek nu in violence", "he is \u03BDiolent"],
  ] as const;

  it.each(HIDDEN_CRISIS)("still flags a phrase hidden with %s", (_, q) => {
    expect(classifyQuestion(q)).toBe("crisis");
  });

  it("flags a sensitive topic hidden with invisible characters", () => {
    expect(classifyQuestion("Will my preg\u200Bnancy go well?")).toBe(
      "sensitive",
    );
    expect(classifyQuestion("Should I stop my medi\u00ADcation?")).toBe(
      "sensitive",
    );
  });

  it("leaves harmless text with the same characters alone", () => {
    expect(classifyQuestion("Will my car\u200B be fine this year?")).toBe(
      "none",
    );
    expect(classifyQuestion("Does ｍｙ Ｖｅｎｕｓ fit his Mars?")).toBe("none");
    // Ordinary accents, names and Sinhala text are not stripped or flagged.
    expect(classifyQuestion("Will José and Zoë get along?")).toBe("none");
    expect(classifyQuestion("අපි දෙදෙනාගේ ගැලපීම කොහොමද?")).toBe("none");
    // A few single letters in a row are not a spread out phrase.
    expect(classifyQuestion("Is it A, B or C for us?")).toBe("none");
    expect(classifyQuestion("I want to skill up myself in astrology")).toBe(
      "none",
    );
    // Russian, Greek and Tamil text is read, not flagged.
    expect(
      classifyQuestion(
        "\u041A\u0430\u043A \u0443 \u043D\u0430\u0441 \u0434\u0435\u043B\u0430 \u0441 \u0412\u0435\u043D\u0435\u0440\u043E\u0439?",
      ),
    ).toBe("none");
    expect(
      classifyQuestion(
        "\u0393\u03B5\u03B9\u03B1 \u03C3\u03BF\u03C5, \u03C0\u03CE\u03C2 \u03B5\u03AF\u03BD\u03B1\u03B9 \u03B7 \u03A3\u03B5\u03BB\u03AE\u03BD\u03B7 \u03BC\u03BF\u03C5;",
      ),
    ).toBe("none");
    expect(
      classifyQuestion(
        "\u0B8E\u0B99\u0BCD\u0B95\u0BB3\u0BCD \u0BAA\u0BCA\u0BB0\u0BC1\u0BA4\u0BCD\u0BA4\u0BAE\u0BCD \u0B8E\u0BAA\u0BCD\u0BAA\u0B9F\u0BBF?",
      ),
    ).toBe("none");
    // Short spaced out abbreviations and lists stay harmless.
    expect(classifyQuestion("Will we visit the U S A together?")).toBe("none");
    expect(classifyQuestion("Is it X Y or Z for us?")).toBe("none");
    expect(classifyQuestion("Will my x-ray results change my plans?")).toBe(
      "none",
    );
    expect(classifyQuestion("Do I cut my losses or end it with him?")).toBe(
      "none",
    );
  });

  it("reads long text in linear time", () => {
    const inputs = [
      "Tell me about my Venus. ".repeat(420),
      "a ".repeat(5000),
      "a.".repeat(5000),
      "k i l l ".repeat(1250),
      "x".repeat(10_000),
      "m y ".repeat(2500),
    ];
    const time = (text: string) => {
      const start = performance.now();
      classifyQuestion(text);
      return performance.now() - start;
    };
    for (const text of inputs) {
      time(text); // warm up
      const at10k = Math.min(time(text), time(text), time(text));
      const long = text.repeat(4);
      const at40k = Math.min(time(long), time(long), time(long));
      expect(at10k).toBeLessThan(100);
      // Four times the text takes far less than sixteen times as long.
      expect(at40k).toBeLessThan(Math.max(8 * at10k, 50));
    }
  });
});

describe("safety copy", () => {
  it("has no em or en dashes", () => {
    expect(CRISIS_REPLY).not.toMatch(/[\u2013\u2014]/);
    expect(SENSITIVE_INSTRUCTION).not.toMatch(/[\u2013\u2014]/);
  });
});
