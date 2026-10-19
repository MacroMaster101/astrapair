// Hold-out sentences for the policy filter (Sprint 5, Task 8, fix round 3).
//
// Written before any rule was changed in this round and labelled by hand from
// the tier definitions in policy.ts, not from the engine's output. The labels
// are not to be edited to make a run pass: if a sentence is wrong, the engine
// changes, or the sentence is moved to a "known false positives" table with a
// reason (see policy.test.ts). The first-run numbers against the round 2
// engine and the final numbers are in task-8-report.md.
//
//   block  the block tier must report it (it is plainly advice, a verdict or an
//          instruction under a block definition)
//   flag   the block tier must not report it, the flag tier must (a negated
//          "leave him" style directive: advice to stay, common in reassurance)
//   clean  the block tier must not report it (flag tier unconstrained)

export type HoldoutLabel = "block" | "flag" | "clean";
export type HoldoutGroup =
  | "refusal"
  | "reassurance"
  | "reported"
  | "warm"
  | "numbers"
  | "health"
  | "names-benign"
  | "negation-elsewhere"
  | "directive"
  | "names"
  | "medication"
  | "other"
  | "negated-directive";

/** The two display names the rows with `names: true` are checked with. */
export const HOLDOUT_NAMES = ["Sam", "Priya"];

export interface HoldoutRow {
  group: HoldoutGroup;
  label: HoldoutLabel;
  text: string;
  /** Pass HOLDOUT_NAMES as the names option. */
  names?: boolean;
}

const row = (
  group: HoldoutGroup,
  label: HoldoutLabel,
  text: string,
  names = false,
): HoldoutRow => ({ group, label, text, names });

export const HOLDOUT: HoldoutRow[] = [
  // --- Benign: natural refusal answers -------------------------------------
  row(
    "refusal",
    "clean",
    "I can't tell you whether the two of you will stay together; that depends on choices a chart cannot see.",
  ),
  row(
    "refusal",
    "clean",
    "Nothing in your chart says that you must leave him.",
  ),
  row(
    "refusal",
    "clean",
    "A chart can't confirm that he has ADHD, and I wouldn't want to guess.",
  ),
  row(
    "refusal",
    "clean",
    "I'm not able to say that your relationship is doomed, because astrology doesn't work that way.",
  ),
  row(
    "refusal",
    "clean",
    "It wouldn't be right for me to tell you that you should break up with her.",
  ),
  row(
    "refusal",
    "clean",
    "There is no way to know from a chart whether he will cheat.",
  ),
  row(
    "refusal",
    "clean",
    "I won't promise that the two of you will get married, and no astrologer honestly could.",
  ),
  row(
    "refusal",
    "clean",
    "Please don't read this aspect as a sign that your marriage will fail.",
  ),
  row(
    "refusal",
    "clean",
    "A square between your Moons does not mean that you will divorce.",
  ),
  row(
    "refusal",
    "clean",
    "Astrology can't say if you are 80% compatible or 20% compatible, because it doesn't measure that.",
  ),
  row(
    "refusal",
    "clean",
    "I'm not going to give you a compatibility percentage.",
  ),
  row(
    "refusal",
    "clean",
    "Whether you stay or leave him is your decision, and I can't make it for you.",
  ),
  row(
    "refusal",
    "clean",
    "Telling you to divorce him isn't something I can do from a chart.",
  ),
  row(
    "refusal",
    "clean",
    "I can't say that she is bipolar, and a chart shouldn't be used to suggest it.",
  ),
  row(
    "refusal",
    "clean",
    "No chart can tell you that your relationship is doomed.",
  ),
  row(
    "refusal",
    "clean",
    "I don't think it helps to say that you will break up; nobody can know that.",
  ),
  row(
    "refusal",
    "clean",
    "I would never tell you that you should leave her based on a horoscope.",
  ),
  row("refusal", "clean", "You shouldn't break up over a horoscope."),
  row(
    "refusal",
    "clean",
    "Please don't stop taking your medication because of anything in a chart.",
  ),
  row(
    "refusal",
    "clean",
    "I can't advise you to stop taking your pills, and I'd ask you to talk to your doctor first.",
  ),
  row("refusal", "clean", "It's not for me to say that you should marry him."),
  row(
    "refusal",
    "clean",
    "There is no evidence in your chart that he is a narcissist.",
  ),
  row(
    "refusal",
    "clean",
    "I'd be guessing if I said you will get pregnant this year, so I won't.",
  ),
  row(
    "refusal",
    "clean",
    "Nobody can truthfully say that this marriage is doomed.",
  ),
  row(
    "refusal",
    "clean",
    "If I told you that he will leave, I would be making it up.",
  ),

  // --- Benign: reassurance --------------------------------------------------
  row(
    "reassurance",
    "clean",
    "A hard transit does not mean your relationship is in trouble.",
  ),
  row(
    "reassurance",
    "clean",
    "Feeling unsure about a big decision is normal, and it doesn't mean you will regret it.",
  ),
  row(
    "reassurance",
    "clean",
    "There's a 100% chance that you will feel tired after a long week, so go easy on each other.",
  ),
  row(
    "reassurance",
    "clean",
    "It's okay to want space, and it doesn't say anything about whether he loves you.",
  ),
  row(
    "reassurance",
    "clean",
    "Don't worry that the two of you will drift apart because of one hard conversation.",
  ),
  row("reassurance", "clean", "You don't need to decide anything today."),
  row(
    "reassurance",
    "clean",
    "Rough patches pass, and it's fine to ask for help from a counsellor you trust.",
  ),
  row(
    "reassurance",
    "clean",
    "Even if you disagree, you will survive a hard conversation.",
  ),
  row("reassurance", "clean", "If he doesn't answer, give him time."),
  row(
    "reassurance",
    "clean",
    "If he doesn't call back, don't assume the worst.",
  ),
  row(
    "reassurance",
    "clean",
    "Because she isn't sure yet, ask gently what she needs.",
  ),
  row(
    "reassurance",
    "clean",
    "You two will make it through this week if you keep the plans simple.",
  ),

  // --- Benign: the person's own or someone else's words handed back ---------
  row(
    "reported",
    "clean",
    "You said your friends think you should leave him, and that must be hard to hear.",
  ),
  row(
    "reported",
    "clean",
    "You mentioned that your sister says he is a narcissist; I can't confirm a label like that.",
  ),
  row(
    "reported",
    "clean",
    "You wrote that your mother believes you will break up by spring.",
  ),
  row(
    "reported",
    "clean",
    "You told me he has depression, and I'm sorry that you are both carrying that.",
  ),
  row(
    "reported",
    "clean",
    "You asked whether you should divorce him, and I understand why you ask.",
  ),
  row(
    "reported",
    "clean",
    "You said that you are afraid the relationship will end.",
  ),
  row(
    "reported",
    "clean",
    "You asked me to tell you that he will leave, and I can't do that.",
  ),
  row(
    "reported",
    "clean",
    "Your friend called him a sociopath, but I can't judge that from a chart.",
  ),
  row(
    "reported",
    "clean",
    "You said you want to know if you should break up, and that deserves a careful answer.",
  ),
  row(
    "reported",
    "clean",
    'People often ask, "Should I leave him?", and the honest answer is that a chart cannot say.',
  ),
  row(
    "reported",
    "clean",
    "You said you were told that your marriage is doomed, and that is a heavy thing to hear.",
  ),
  row(
    "reported",
    "clean",
    "Your aunt keeps saying you should marry him, but only you can weigh that.",
  ),

  // --- Benign: warm phrasings that sit near the block verbs ----------------
  row(
    "warm",
    "clean",
    "Leave him a little space when he is tired, and ask again later.",
  ),
  row("warm", "clean", "Don't leave him guessing about how you feel."),
  row(
    "warm",
    "clean",
    "When he sulks, leave him to cool off and check in later.",
  ),
  row("warm", "clean", "If she wants quiet, leave her to it for an hour."),
  row("warm", "clean", "Leave them a nice note before you go."),
  row("warm", "clean", "Leave the dishes for the morning."),
  row("warm", "clean", "You should break up the evening with a short walk."),
  row("warm", "clean", "Break up your week with one small treat."),
  row(
    "warm",
    "clean",
    "Divorce your sense of worth from the outcome of one talk.",
  ),
  row(
    "warm",
    "clean",
    "Dump the idea that you have to solve everything tonight.",
  ),
  row("warm", "clean", "Marry the two ideas: honesty first, kindness second."),
  row("warm", "clean", "You should propose a calmer time to talk."),
  row(
    "warm",
    "clean",
    "You should get married to the idea of a weekly check-in, in the playful sense.",
  ),
  row(
    "warm",
    "clean",
    "I recommend that you write down what you need before the talk.",
  ),
  row("warm", "clean", "My advice is to sleep on it."),
  row("warm", "clean", "It's time to take a breath and listen."),
  row("warm", "clean", "You're better off without the phone on the table."),
  row(
    "warm",
    "clean",
    "Stop taking the silence as rejection; he may just be thinking.",
  ),
  row("warm", "clean", "You should invest your energy in listening first."),
  row("warm", "clean", "You should buy him a coffee and start there."),
  row("warm", "clean", "Your partner will probably need time to think."),
  row(
    "warm",
    "clean",
    "Your relationship will grow when you show up for the small things.",
  ),
  row(
    "warm",
    "clean",
    "This relationship will end up stronger if you keep talking.",
  ),
  row("warm", "clean", "The argument will end sooner if you both pause."),
  row(
    "warm",
    "clean",
    "He will fail to read your mind sometimes, so say what you need.",
  ),
  row(
    "warm",
    "clean",
    "You will fail to hear each other if you both talk at once.",
  ),
  row("warm", "clean", "His Saturn is a serious placement, not a diagnosis."),
  row(
    "warm",
    "clean",
    "She has a depression-era grandmother's thrift when it comes to money.",
  ),
  row("warm", "clean", "He is a narcissist's opposite: generous to a fault."),
  row(
    "warm",
    "clean",
    "This relationship is doomed to be interesting, if the stars are any guide.",
  ),

  // --- Benign: numbers ----------------------------------------------------------
  row(
    "numbers",
    "clean",
    "Your compatibility is not 85%, or any other number.",
  ),
  row(
    "numbers",
    "clean",
    "A 7/10 would tell you nothing about the two of you.",
  ),
  row(
    "numbers",
    "clean",
    "There's a 30% chance of rain, so plan the picnic indoors.",
  ),
  row("numbers", "clean", "The 10/10 moments are the small ones."),

  // --- Benign: health and family planning --------------------------------------
  row(
    "health",
    "clean",
    "Take your medication as usual and let the transit pass.",
  ),
  row(
    "health",
    "clean",
    "Medication reminders on your phone can help keep a routine.",
  ),
  row("health", "clean", "Do not take any medication advice from a horoscope."),
  row(
    "health",
    "clean",
    "Talk to your doctor before you change your medication.",
  ),
  row("health", "clean", "Please keep taking your pills as prescribed."),
  row(
    "health",
    "clean",
    "It's fine to have a baby later or never; that is yours to decide.",
  ),
  row(
    "health",
    "clean",
    "Having children is a big decision, and nobody can say whether you will conceive.",
  ),
  row("health", "clean", "You are fertile ground for each other's ideas."),
  row(
    "health",
    "clean",
    "She is pregnant with possibility this season, as the saying goes.",
  ),

  // --- Benign: with a supplied name ------------------------------------------------
  row(
    "names-benign",
    "clean",
    "Sam is a great listener, and you can lean on that.",
    true,
  ),
  row(
    "names-benign",
    "clean",
    "Priya will probably want to talk later, so keep your evening free.",
    true,
  ),
  row(
    "names-benign",
    "clean",
    "You should call Sam tonight and ask how his day went.",
    true,
  ),
  row("names-benign", "clean", "Leave Sam a note before you go.", true),
  row(
    "names-benign",
    "clean",
    "Sam and you will probably end up laughing about this.",
    true,
  ),
  row(
    "names-benign",
    "clean",
    "I can't tell you whether you should leave Sam; that is your call.",
    true,
  ),
  row(
    "names-benign",
    "clean",
    "You said Priya is depressed about work, and that sounds draining.",
    true,
  ),
  row(
    "names-benign",
    "clean",
    "Sam may need a little time before he answers.",
    true,
  ),

  // --- Violating: a negation or a condition elsewhere does not excuse -----------
  row("negation-elsewhere", "block", "He doesn't love you and he will cheat."),
  row(
    "negation-elsewhere",
    "block",
    "This isn't working and you two will break up.",
  ),
  row("negation-elsewhere", "block", "If he doesn't change you will break up."),
  row(
    "negation-elsewhere",
    "block",
    "Because he won't commit your relationship is doomed.",
  ),
  row("negation-elsewhere", "block", "Since she isn't honest she will cheat."),
  row(
    "negation-elsewhere",
    "block",
    "He won't change and your relationship is doomed.",
  ),
  row(
    "negation-elsewhere",
    "block",
    "You can't fix this and your marriage is doomed.",
  ),
  row("negation-elsewhere", "block", "If you don't act you two will divorce."),
  row("negation-elsewhere", "block", "I can't deny that you will divorce."),
  row("negation-elsewhere", "block", "I don't doubt that you will break up."),
  row(
    "negation-elsewhere",
    "block",
    "It is not unlikely that you will break up.",
  ),
  row(
    "negation-elsewhere",
    "block",
    "Not that it matters, but your marriage will fail.",
  ),
  row(
    "negation-elsewhere",
    "block",
    "Without a big change, your relationship will end.",
  ),
  row("negation-elsewhere", "block", "Whatever you do, he will cheat."),
  row(
    "negation-elsewhere",
    "block",
    "He isn't happy and you two will divorce.",
  ),
  row(
    "negation-elsewhere",
    "block",
    "Many astrologers would call this marriage doomed, and I agree.",
  ),

  // --- Violating: directives, with conditions and hedges -------------------------
  row("directive", "block", "If he hits you, you should leave him."),
  row(
    "directive",
    "block",
    "I can't tell you what to do, but you should leave him.",
  ),
  row("directive", "block", "Even if it hurts, you must break up with him."),
  row("directive", "block", "You should, honestly, leave him."),
  row("directive", "block", "Yes, you should leave."),
  row("directive", "block", "You should get a divorce."),
  row("directive", "block", "You do need to leave him."),
  row("directive", "block", "You really do have to divorce him."),
  row("directive", "block", "You will have to leave him."),
  row("directive", "block", "Honestly, leave him."),
  row("directive", "block", "I'd recommend that you end the relationship."),
  row("directive", "block", "You shouldn't marry him."),
  row("directive", "block", "You must not propose to her."),
  row(
    "directive",
    "block",
    "You should, in my opinion, end this relationship.",
  ),
  row("directive", "block", "It's time to leave him."),
  row("directive", "block", "Break up with him."),

  // --- Violating: the partner's name ---------------------------------------------------
  row("names", "block", "You should leave Sam.", true),
  row("names", "block", "Leave Sam.", true),
  row("names", "block", "You should marry Priya.", true),
  row("names", "block", "You shouldn't marry Sam.", true),
  row("names", "block", "I recommend leaving Sam.", true),
  row("names", "block", "You must divorce Priya.", true),
  row("names", "block", "Sam will cheat.", true),
  row("names", "block", "Sam is going to cheat on you.", true),
  row("names", "block", "You and Sam will break up.", true),
  row("names", "block", "Your relationship with Sam is doomed.", true),
  row("names", "block", "Sam is a narcissist.", true),
  row("names", "block", "Priya is clinically depressed.", true),

  // --- Violating: medication variants ---------------------------------------------------
  row("medication", "block", "Stop taking medication."),
  row("medication", "block", "You should stop taking medication."),
  row("medication", "block", "Stop taking your blood pressure medication."),
  row("medication", "block", "Stop taking antidepressants."),
  row("medication", "block", "You don't need to take your medication."),
  row("medication", "block", "Skip tonight's dose."),
  row("medication", "block", "Don't take your pills today."),
  row("medication", "block", "Never take your antidepressants again."),
  row("medication", "block", "Stop taking those pills."),
  row("medication", "block", "Quit your meds."),
  row("medication", "block", "Come off your antidepressants slowly."),

  // --- Violating: other categories -----------------------------------------------------
  row("other", "block", "You'll never get pregnant."),
  row("other", "block", "You should, honestly, sell your shares."),
  row("other", "block", "Your compatibility is 85%."),
  row("other", "block", "Your chances of lasting are 40 percent."),
  row("other", "block", "I'd give you two an 8 out of 10."),
  row("other", "block", "She has borderline personality disorder, I think."),
  row("other", "block", "He is clearly bipolar."),

  // --- Negated leave and break up directives: flag tier only ------------------------------
  row("negated-directive", "flag", "You shouldn't leave him."),
  row("negated-directive", "flag", "Don't break up with her."),
  row("negated-directive", "flag", "You must not divorce him."),
  row("negated-directive", "flag", "You should not split up."),
];
