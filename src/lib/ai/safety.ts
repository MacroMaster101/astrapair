import { SIGNS } from "@/lib/astrology/types";

export type SafetyCategory = "crisis" | "sensitive" | "none";

// Crisis detection favours recall: a supportive reply to a harmless question
// costs little, a missed disclosure costs a lot.
//
// 1. Self-harm and suicidal phrases are a crisis wherever they appear.
// 2. Each sentence is then checked for harm from someone else: a violence stem
//    in any tense together with a first-person target ("me", "my kids",
//    "I was punched"), or a term that needs no target ("abusive", "violent").
//    Before that check a short list of idioms is removed ("hit me up",
//    "beats me at chess", "Saturn hits my Venus", "hit hard by the breakup").

const alt = (parts: string[]) => `(?:${parts.join("|")})`;

// ---------------------------------------------------------------------------
// 1. Self-harm and suicidal ideation
// ---------------------------------------------------------------------------

const SELF_HARM_TERMS = [
  "suicid\\w*",
  // Common misspellings: "sucidal", "suicde", "suiside".
  "s(?:ui|iu|uu|u)[cs]i?d(?:e|al|le)\\w*",
  "unaliv\\w*",
  "self[- ]?harm\\w*",
  "(?:kil{1,2}|kil{1,2}ing|hurt|hurting|harm|harming|cut|cutting|burn|burning|injure|injuring|hang|hanging|shoot|shooting|drown|drowning|starve|starving|stab|stabbing|poison|poisoning)\\s+my\\s?self",
  "kill(?:s|ed|ing)?\\s+(?:himself|herself|themselves|themself)",
  "(?:hurt|harm|cut)(?:s|ing)?\\s+(?:himself|herself|themselves|themself)\\s+if\\s+i",
  "(?:end|ending|ended|take|taking|took)\\s+my\\s+(?:own\\s+)?life",
  "end(?:ing|ed)?\\s+it\\s+all",
  // "I want to end it", "thinking about ending it"; not "end it with him".
  "(?:want(?:ed)?\\s+to|wanna|going\\s+to|gonna|ready\\s+to|decided\\s+to|about\\s+to|plan(?:ning)?\\s+to|think(?:ing)?\\s+(?:about|of)|thought\\s+(?:about|of))\\s+(?:just\\s+)?end(?:ing)?\\s+it\\b(?!\\s+(?:with|between))",
  "want(?:s|ed|ing)?\\s+(?:it\\s+all|everything)\\s+to\\s+(?:end|stop|be\\s+over)",
  // Not "die laughing".
  "(?:want(?:s|ed|ing)?\\s+to|wanna|ready\\s+to|should|plan(?:s|ning|ned)?\\s+to|told\\s+me\\s+to|tells\\s+me\\s+to)\\s+(?:just\\s+)?die(?!\\s+(?:laughing|of\\s+(?:laughter|embarrassment|shame)))",
  "(?:wants?|wanted|wish(?:es|ed)?)\\s+me\\s+dead",
  "if\\s+i\\s+(?:(?:was|were)\\s+dead|(?:just\\s+)?died)",
  "(?:nobody|no\\s+one|noone)\\s+would\\s+(?:even\\s+)?miss\\s+me",
  "better\\s+(?:off\\s+)?without\\s+me",
  "(?:life|living)\\s+(?:isn'?t|is\\s+not|is\\s+no\\s+longer)\\s+worth\\s+it",
  "swallow\\w*\\b[^.!?]{0,30}\\b(?:pills|tablets|meds)",
  "death\\s+(?:seems|is|feels|looks)\\b[^.!?]{0,20}\\b(?:way\\s+out|answer|option|solution)",
  "want(?:s|ed)?\\s+out\\s+of\\s+(?:this\\s+|my\\s+)?life",
  "done\\s+with\\s+(?:life|living|being\\s+alive)",
  "want(?:s|ed)?\\s+(?:it\\s+all|it|everything)\\s+to\\s+(?:stop|end)\\s+forever",
  "wish(?:es|ed)?\\s+(?:that\\s+)?i\\s+(?:was|were)\\s+(?:dead|gone|never\\s+born)",
  "wish(?:es|ed)?\\s+(?:that\\s+)?i\\s+(?:wasn'?t|weren'?t|was\\s+not|were\\s+not)\\s+(?:alive|here|born|around)",
  "wish(?:es|ed)?\\s+(?:that\\s+)?i\\s+(?:could|would)\\s+(?:just\\s+)?(?:die|disappear(?!\\s+(?:into|in\\s+the|from\\s+the|for\\s+a))|vanish|not\\s+wake\\s+up|stop\\s+existing)",
  "wish(?:es|ed)?\\s+(?:that\\s+)?i(?:'d|\\s+had)\\s+never\\s+been\\s+born",
  "better\\s+off\\s+(?:dead|if\\s+i\\s+(?:was|were|wasn'?t|weren'?t))",
  // Not "don't want to live with his parents", "wake up next to him".
  "(?:don'?t|do\\s+not|no\\s+longer|never|didn'?t)\\s+(?:even\\s+|really\\s+)?(?:want\\s+to|wanna)\\s+(?:live(?!\\s+(?:with|in|at|near|there|together|apart)\\b)|be\\s+alive|wake\\s+up(?!\\s+(?:next|early|beside|with|at|to)\\b)|be\\s+here|exist|be\\s+around)",
  "(?:not|isn'?t|ain'?t)\\s+worth\\s+living",
  "(?:no|any|the|a)\\s+(?:point|reason)\\s+(?:in|to|of)\\s+(?:living|live|going\\s+on|go\\s+on|being\\s+alive|be\\s+alive)",
  "nothing\\s+(?:left\\s+)?to\\s+live\\s+for",
  "(?:lost|no)\\s+(?:the\\s+|my\\s+)?will\\s+to\\s+live",
  "(?:tired|sick)\\s+of\\s+(?:being\\s+alive|living(?!\\s+(?:with|in|here|there|together|apart)\\b))",
  "think(?:s|ing)?\\s+(?:a\\s+lot\\s+)?(?:about|of)\\s+(?:dying|death|my\\s+(?:own\\s+)?death|ending\\s+(?:things|everything)|not\\s+being\\s+(?:here|alive|around))",
  "thoughts?\\s+(?:about|of)\\s+(?:dying|death|ending\\s+(?:it|things))",
  // First-person only: "our relationship can't go on like this" is not a crisis,
  // nor is "I can't go on holiday".
  "i\\s+(?:just\\s+|really\\s+|honestly\\s+)?(?:can'?t|cannot|can\\s+not)\\s+(?:go|keep\\s+going|carry)\\s+on\\b(?!\\s+(?:an?|the|our|my|his|her|this|that|dates?|holidays?|vacation|trips?|with\\s+(?:him|her|them|this\\s+relationship))\\b)",
  "disappear\\s+forever",
  "(?:want(?:s|ed)?\\s+to|wanna)\\s+(?:just\\s+)?(?:disappear(?!\\s+(?:into|in\\s+the|from\\s+the|for\\s+a))|vanish|stop\\s+existing|not\\s+exist)",
  "overdos\\w*",
  "(?:too\\s+many|a\\s+(?:whole\\s+)?bottle\\s+of|all\\s+(?:of\\s+)?(?:my|the|his|her))\\s+(?:sleeping\\s+)?(?:pills|tablets|meds)",
  "pills\\s+on\\s+purpose",
  "(?:slit|slitting|slash|slashing|cut|cutting)\\s+my\\s+(?:wrists?|arms?|thighs?|legs?|skin|throat)",
  "jump(?:ing)?\\s+off\\s+(?:a|the|my)\\s+(?:bridge|roof|building|balcony|cliff)",
  "never\\s+wak(?:e|ing)\\s+up",
  // "I can't stop cutting", "can't stop hurting myself".
  "(?:can'?t|cannot|can\\s+not|couldn'?t|unable\\s+to)\\s+stop\\s+(?:cutting|burning|hurting)(?:\\s+my\\s?self)?",
];

const SELF_HARM = new RegExp(`\\b${alt(SELF_HARM_TERMS)}\\b`);

// ---------------------------------------------------------------------------
// 2. Harm from someone else
// ---------------------------------------------------------------------------

/** Verbs that are plainly violent, in every tense. */
const CLEAR_VERBS = [
  "hitt?(?:s|ing)?",
  "beat(?:s|ing|en)?",
  "punch(?:es|ed|ing)?",
  "slap(?:s|ped|ping)?",
  "kick(?:s|ed|ing)?",
  "chok(?:e|es|ed|ing)",
  "strangl(?:e|es|ed|ing)",
  "drown(?:s|ed|ing)?",
  "smother(?:s|ed|ing)?",
  "stab(?:s|bed|bing)?",
  "whip(?:s|ped|ping)?",
  "smack(?:s|ed|ing)?",
  "str(?:ike|ikes|iking|uck)",
  "shov(?:e|es|ed|ing)",
  "attack(?:s|ed|ing)?",
  "threat(?:s|en|ens|ened|ening)?",
  "hurt(?:s|ing)?",
];
/** Everyday verbs and objects that are violent only with a first-person target. */
const OTHER_STEMS = [
  "cut(?:s|ting)?",
  "burn(?:s|ed|t|ing)?",
  "push(?:es|ed|ing)?",
  "grab(?:s|bed|bing)?",
  "drag(?:s|ged|ging)?",
  "stalk(?:s|ed|ing|er)?",
  "forc(?:e|es|ed|ing)",
  // "bit me", but not "a bit".
  "bit(?:e|es|ing|ten)|(?<!\\b(?:a|little|tiny|wee|by)\\s)bit(?!\\s+(?:by|of|more|less|much|too)\\b)",
  "scratch(?:es|ed|ing)?",
  "sh(?:ake|akes|aking|ook|aken)",
  "knock(?:s|ed|ing)?",
  "sp(?:it|its|at|itting)\\s+(?:on|at|in)",
  "kni(?:fe|ves)",
  "guns?",
  "weapons?",
];
const CLEAR = alt(CLEAR_VERBS);
const STEM = alt([...CLEAR_VERBS, ...OTHER_STEMS]);

const FAMILY =
  "(?:kids?|child(?:ren)?|sons?|daughters?|baby|babies|mom|mum|mother|sister|brother|family)";
const BODY =
  "(?:head|face|neck|throat|arms?|wrists?|ribs|stomach|chest|body|eye|jaw|nose)";
/** "I was punched", "I got slapped", "am I being hit", "I've been beaten". */
const PASSIVE_AUX =
  "(?:i'?m|i\\s+am|am\\s+i|i\\s+was|was\\s+i|i\\s+got|i\\s+get|i\\s+keep\\s+getting|i\\s+kept\\s+getting|i(?:'ve|\\s+have|'d|\\s+had)\\s+been|have\\s+i\\s+been)";
const PASSIVE_ADVERB =
  "(?:being|getting|constantly|always|often|just|even|also|still|really|repeatedly|regularly|recently|physically|sexually)";
const PARTICIPLE =
  "(?:hit|beaten|beat|punched|slapped|kicked|choked|strangled|stabbed|cut|burned|burnt|whipped|smacked|struck|shoved|pushed|grabbed|dragged|threatened|attacked|drowned|smothered|stalked|forced|bitten|bit|scratched|shaken|knocked|hurt\\s+by)";

/** Who the violence is aimed at: the user, their children or family, their body. */
const FIRST_PERSON_TARGET = new RegExp(
  `\\bme\\b|\\b(?:my|our)\\s+(?:(?:own|little|younger|youngest|older|oldest|step)\\s+)?(?:${FAMILY}|dog|cat|${BODY})\\b|\\b${PASSIVE_AUX}(?:\\s+${PASSIVE_ADVERB})*\\s+${PARTICIPLE}\\b`,
);
const VIOLENCE_STEM = new RegExp(`\\b${STEM}\\b`);

const SEX = "(?:sex|sexual\\w*|sle(?:ep|eps|eping|pt)\\s+with|intercourse)";
const AFRAID = "(?:afraid|scared|terrified|frightened)";
const WONT =
  "(?:won'?t|wouldn'?t|doesn'?t|didn'?t|will\\s+not|does\\s+not|did\\s+not|never|refus\\w+\\s+to)";
const HELPLESS =
  "(?:when|while)\\s+i(?:'?m|\\s+am|\\s+was)\\s+(?:asleep|sleeping|drunk|passed\\s+out|unconscious)";
const COERCE = "(?:forc|pressur|coerc)\\w*";
const PARTNER_WORDS =
  "(?:husband|wife|partner|boyfriend|girlfriend|fianc\\w+|spouse|ex|dad|father|stepdad|stepfather)";

/** Terms that describe harm on their own, with no first-person target needed. */
const HARM_TERMS = [
  "abus(?:e|ed|es|ing|ive|er|ers)",
  "domestic\\s+violence",
  // "He is violent", "gets violent", "a violent relationship".
  "violen(?:t|tly|ce)",
  "rap(?:e|ed|es|ing|ist)",
  "molest\\w*",
  "assault\\w*",
  "grop(?:e|es|ed|ing)",
  "kill(?:s|ed|ing)?\\s+(?:me|him|her|them|us)",
  // Violence against the family: "beats his wife", "hits the kids", "hits us".
  `${CLEAR}\\s+(?:up\\s+)?(?:(?:his|her|their|the|our|my)\\s+(?:own\\s+|little\\s+)?(?:wife|husband|girlfriend|boyfriend|partner|father|dad|dog|cat|${FAMILY})|us)`,
  "thr(?:ow|ows|owing|ew|own)\\b[^,]{0,40}\\bat\\s+(?:me|my|us)",
  "lock(?:s|ed|ing)?\\s+(?:me|us)",
  "pin(?:s|ned|ning)?\\s+me\\s+(?:down|against|to)",
  "pull(?:s|ed|ing)?\\s+my\\s+hair",
  "black\\s+eye",
  "bruis(?:e|es|ed|ing)(?!\\s+(?:(?:my|his|her|our|their)\\s+)?(?:ego|pride|heart|feelings))",
  // Euphemisms: "put his hands on me", "got physical", "rough with me".
  "(?:put|puts|putting|laid|lays?|laying)\\s+(?:(?:his|her|their)\\s+)?hands\\s+(?:on|around)\\s+(?:me|my)",
  "hands\\s+(?:on|around)\\s+my\\s+(?:neck|throat)",
  "g[eo]ts?\\s+physical",
  "physical\\s+with\\s+me",
  "rough\\s+with\\s+(?:me|us|my|the\\s+kids)",
  "rough(?:s|ed|ing)?\\s+(?:me\\s+)?up",
  "forceful\\s+with\\s+me",
  "h(?:old|olds|olding|eld)\\s+me\\s+down",
  `${PASSIVE_AUX}(?:\\s+${PASSIVE_ADVERB})*\\s+(?:thrown|locked\\s+(?:in|inside|up|out)|held\\s+down|pinned|tied\\s+up)`,
  // Children: "take the kids and hurt them".
  `(?:kids?|child(?:ren)?|baby)\\b.*\\b${CLEAR}\\s+(?:them|him|her)`,
  // Sexual coercion
  `${COERCE}\\b.*\\b${SEX}`,
  `${SEX}\\b.*\\b${COERCE}`,
  `ma(?:kes?|de|king)\\s+me\\s+(?:(?:have|do|perform|watch)\\b.*\\b${SEX}|do\\s+things)`,
  "forc\\w*\\s+(?:himself|herself|themselves|themself)\\s+on",
  "without\\s+(?:my\\s+|any\\s+)?consent",
  "against\\s+my\\s+will",
  "non-?consensual",
  `${WONT}\\s+take\\s+no`,
  "refus\\w+\\s+to\\s+stop",
  "did\\s+it\\s+anyway",
  "said\\s+(?:no|stop)\\s+(?:but|and\\s+(?:he|she|they))",
  "(?:even\\s+though|although|when|after)\\s+i\\s+said\\s+(?:no|stop)",
  "keeps?\\s+touching\\s+me",
  `touch(?:es|ed|ing)?\\s+me\\b.*\\b(?:don'?t\\s+want|didn'?t\\s+want|without|won'?t\\s+stop|wouldn'?t\\s+stop|when\\s+i\\s+was\\s+(?:little|young|a\\s+(?:kid|child)|\\d+))`,
  `(?:${SEX}|clothes|undress\\w*|touch\\w*)\\b.*\\b${HELPLESS}`,
  `no\\s+choice\\b.*\\b${SEX}`,
  `${SEX}\\b.*\\bno\\s+choice`,
  "s(?:old|ells?|elling)\\s+me(?!\\s+on)",
  // Control
  `${WONT}\\s+lets?\\s+me\\s+(?:leave|go|out)`,
  "(?:took|takes|taking|hid|hides|hiding)\\s+my\\s+(?:phone|keys|car\\s+keys|passport|wallet)",
  `controlling\\b.*\\b${AFRAID}`,
  `${AFRAID}\\b.*\\bcontrolling`,
  `follow(?:s|ed|ing)?\\s+me\\b.*\\b${AFRAID}`,
  // Stalking, with no fear word needed.
  "follow(?:s|ed|ing)?\\s+me\\s+(?:home|everywhere)",
  "(?:keeps?|kept)\\s+showing\\s+up\\s+at\\s+my\\s+(?:work|house|home|job|office)",
  "(?:didn'?t|wouldn'?t|won'?t|doesn'?t|did\\s+not|does\\s+not)\\s+stop\\s+when\\s+i\\s+(?:said|say|told|asked|begged)",
  // Fear and danger
  "(?:he|she|they|husband|wife|partner|boyfriend|girlfriend|ex)\\s+(?:really\\s+|sometimes\\s+|often\\s+)?(?:scares|frightens|terrifies)\\s+me",
  `${AFRAID}\\s+to\\s+go\\s+home`,
  `${AFRAID}\\s+of\\s+(?:(?:him|them)(?!\\s+\\w+ing\\b)|her(?!\\s+\\w)|my\\s+${PARTNER_WORDS}(?!'|\\s+\\w+ing\\b))`,
  "(?:fear|afraid|scared|terrified|frightened)\\s+for\\s+my\\s+(?:life|safety)",
  "(?:don'?t|do\\s+not|never|no\\s+longer)\\s+feel\\s+safe",
  "(?:not|un)\\s*safe\\s+(?:with|around|at\\s+home)",
  "(?:i'?m|i\\s+am|am\\s+i)\\s+in\\s+danger(?!\\s+of)",
];
const HARM = new RegExp(`\\b${alt(HARM_TERMS)}\\b`);

// ---------------------------------------------------------------------------
// Idioms that are not violence. Kept short on purpose.
// ---------------------------------------------------------------------------

/** Things that "hit" someone without being a person. Never "it". */
const NON_PERSON = alt([
  "sun",
  "moon",
  "mercury",
  "venus",
  "mars",
  "mood",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
  "chiron",
  "lilith",
  "ascendant",
  "descendant",
  "midheaven",
  "rising",
  "nodes?",
  "planets?",
  "stars?",
  "transits?",
  "returns?",
  "retrogrades?",
  "eclipses?",
  "aspects?",
  "squares?",
  "oppositions?",
  "conjunctions?",
  "trines?",
  "sextiles?",
  "placements?",
  "seasons?",
  "energy",
  "energies",
  "charts?",
  "horoscopes?",
  "astrology",
  "universe",
  "life",
  "waves?",
  "breakup",
  "break-up",
  "news",
  "criticism",
  "reality",
  "reali[sz]ation",
  "truth",
  "grief",
  "loss",
  "stress",
  "anxiety",
  "exhaustion",
  "emotions?",
  "feelings?",
  "sadness",
  "loneliness",
  "guilt",
  "jealousy",
  "words",
  "comments",
  "silence",
]);
const PEOPLE =
  "(?:he|him|she|her|they|them|husband|wife|partner|boyfriend|girlfriend|fianc\\w+|spouse|ex|dad|father|mom|mum|mother|brother|sister|someone|somebody|man|guy|woman)";
const FILLER =
  "(?:is|are|was|were|will|would|can|could|may|might|does|do|did|has|have|had|been|being|keeps?|kept|gets?|got|getting|going\\s+to|gonna|about\\s+to|to|really|always|often|sometimes|just|even|still|also|currently|now|so|very|quite|such|an?|the|ever|suddenly|constantly|usually)";
// "Saturn in my 7th house", "Mars in Aries".
const PLACEMENT = `(?:\\s+in\\s+(?:(?:my|his|her|their|our|your|the)\\s+)?(?:[\\w°]+\\s+){0,2}?(?:house|chart|sign|${SIGNS.join("|")}))?`;
const BY_DETERMINER =
  "(?:an?|the|this|that|these|those|my|our|his|her|their|some|such|all|so\\s+much|so\\s+many|(?:a\\s+)?lots?\\s+of|a\\s+(?:huge\\s+|big\\s+|sudden\\s+)?wave\\s+of|waves\\s+of)";
const GAMES =
  "(?:chess|cards|games?|poker|tennis|scrabble|mario\\s+kart|golf|pool|darts|trivia|monopoly|everything|arguments|checkers|quizzes|astrology|sports|bowling|wordle|uno|maths?|puzzles|debates)";
const THEIR =
  "(?:my|his|her|our|their|your|each\\s+other'?s|one\\s+another'?s)";

const NOT_VIOLENCE = [
  // A message, a race, a game
  "hit(?:s|ting)?\\s+me\\s+up(?!\\s+(?:against|into|onto))",
  "beat(?:s|ing|en)?\\s+me\\s+to\\s+(?:it|the\\s+punch|(?:an?|the)\\s+(?:promotion|job|deal|answer|seat|spot|table))",
  `beat(?:s|ing|en)?\\s+me\\s+at\\s+(?:(?:board|card|video|word|computer|party)\\s+)?${GAMES}`,
  // "Beats me why we argue": only with no subject, or with "it".
  "(?:(?<!\\w\\s)|(?<=\\bit\\s))beats\\s+me\\s+(?:why|how|what|whether)",
  "beat(?:s|ing)?\\s+(?:myself|ourselves|himself|herself|themselves|yourself)\\s+up",
  // Intimacy: "we got physical", "things get physical". Not "it got physical with me".
  "(?:we|us|things|it)\\s+g[eo]ts?\\s+physical(?!\\s+with\\s+(?:me|my|the\\s+kids))",
  // Distance and encouragement, unless someone fell
  "push(?:es|ed|ing)?\\s+me\\s+away(?!\\s+and\\s+i\\s+(?:fell|hit|landed|tripped))",
  // Not when the push is against their wishes: "pushes me to go further than I want".
  "push(?:es|ed|ing)?\\s+me(?![^.!?]*\\b(?:than\\s+i\\s+want|when\\s+i\\s+say\\s+no|when\\s+i\\s+don'?t\\s+want|too\\s+far)\\b)\\s+(?:to\\s+(?:be|do|try|grow|become|improve|work|learn|pursue|follow|chase|reach|achieve|go|take|stay)\\b|(?:outside|beyond|out\\s+of)\\s+my\\s+comfort\\s+zone|(?:harder|further)(?!\\s+(?:into|against|down|onto)))",
  `push(?:es|ed|ing)?\\s+${THEIR}\\s+buttons`,
  "grab(?:s|bed|bing)?\\s+me\\s+(?:an?(?!\\s+(?:few|couple|lot|second|number)\\b)|some|another)",
  // Emotional hurt
  "(?:it|this|what)(?:\\s+(?:really|still|just|always|also|only|even|does|did|would|will|has|had))*\\s+(?:hurt(?:s|ing)?|kill(?:s|ed|ing)?)\\s+me",
  // A realisation: "it hit me that I love him", "That hit me hard when ...".
  "hit\\s+me\\s+that\\s+i",
  "(?<![a-z]\\s)(?:that|it|this)\\s+(?:really\\s+|just\\s+)?hit\\s+me\\s+(?:so\\s+|really\\s+|pretty\\s+)?hard",
  "grab(?:s|bed|bing)?\\s+(?:lunch|dinner|breakfast|brunch|coffee|food|drinks?|a\\s+bite)",
  `hurt(?:s|ing)?\\s+${THEIR}\\s+(?:feelings|pride|ego)`,
  "hurt\\s+(?:before|in\\s+the\\s+past|in\\s+(?:my\\s+)?(?:past|previous)\\s+relationships?|emotionally)",
  "fe(?:el|els|eling|lt)\\s+(?:so\\s+|really\\s+|very\\s+|deeply\\s+|a\\s+bit\\s+)?(?:hurt|attacked|smothered|pushed|cut\\s+off|burn(?:ed|t)\\s+out|beaten\\s+down)",
  // Everyday uses of the other stems
  "hit(?:s|ting)?\\s+(?:it\\s+off|on\\s+(?:me|him|her)|rock\\s+bottom|(?:a|the|another)\\s+(?:rough|snag|bump|low|nerve|milestone|point|plateau))",
  "cut(?:s|ting)?\\s+(?:me\\s+(?:off|out|some\\s+slack|loose|short)|(?:off\\s+)?(?:all\\s+)?(?:contact|ties)|(?:my|our)\\s+losses|back|down|corners)",
  "str(?:ike|ikes|uck|iking)\\s+(?:me\\s+as(?!\\s+(?:often|hard|much|soon))|a\\s+(?:balance|chord|nerve|deal))",
  "burn(?:s|ed|t|ing)?\\s+(?:me\\s+)?out(?!\\s+of)",
  "smother(?:s|ed|ing)?\\s+me\\s+(?:with|in)\\s+(?:love|affection|attention|kisses|texts|gifts|kindness|hugs|care)",
  "stab(?:s|bed|bing)?\\s+me\\s+in\\s+the\\s+back(?!\\s+with)",
  "chok(?:e|es|ed|ing)\\s+up",
  "sh(?:ake|akes|aking|ook)\\s+hands",
  "i\\s+sh(?:ake|ook)(?!\\s+(?:him|her|them|my|the|our)\\b)",
  "drown(?:s|ed|ing)?\\s+in",
  // "tell me why", "help me understand": the "me" is the assistant's listener.
  "(?:tell|show|help|teach|remind|advise|guide)\\s+me\\s+(?=(?:why|how|what|when|where|whether|if|about|more|understand|see|figure|know|which|who)\\b)",
  // "hit hard by the breakup", "hit by a Saturn return"; never by a person.
  `(?:hit|struck|hurt)(?:\\s+(?:so|really|very|pretty|quite|too))?(?:\\s+hard(?:er)?)?\\s+by\\s+(?:${BY_DETERMINER}\\s+){0,2}(?:(?!${PEOPLE}\\b)[a-z]+\\s+)?${NON_PERSON}`,
  // A planet, transit or feeling as the subject: "Saturn hits my Venus".
  `${NON_PERSON}(?:'s)?(?:\\s+(?:of|about|from)\\s+(?:${THEIR}\\s+)?(?!${PEOPLE}\\b)[a-z]+)?${PLACEMENT}(?:\\s+${FILLER})*\\s+(?:${STEM}|kill(?:s|ed|ing)?|violen(?:t|ce))`,
].map((source) => new RegExp(`\\b${source}\\b`, "g"));

function describesHarm(sentence: string): boolean {
  let rest = sentence;
  for (const idiom of NOT_VIOLENCE) rest = rest.replace(idiom, " | ");
  if (HARM.test(rest)) return true;
  return VIOLENCE_STEM.test(rest) && FIRST_PERSON_TARGET.test(rest);
}

function isCrisis(text: string): boolean {
  if (SELF_HARM.test(text)) return true;
  return text.split(/[.!?;\n]+/).some(describesHarm);
}

// ---------------------------------------------------------------------------
// Sensitive topics
// ---------------------------------------------------------------------------

const MONEY_WORDS =
  "(?:shares|crypto\\w*|bitcoin|savings|property|real\\s+estate|business|funds?)";
const INVEST = "invest(?:ing|ment|ments|ed|s)?";

const SENSITIVE_TERMS = [
  "pregnan(?:t|cy)",
  "fertility",
  "illness",
  "disease",
  "diagnos(?:is|ed|e)",
  "depress(?:ion|ed)",
  "anxiety disorder",
  "bipolar",
  "medication",
  "lawsuit",
  "crime",
  "money",
  "stocks?",
  "debt",
  "lottery",
  // "invest" alone is common in relationship talk, so it needs a money word.
  `${INVEST}\\b[^.?!]{0,40}\\b${MONEY_WORDS}`,
  `${MONEY_WORDS}\\b[^.?!]{0,40}\\b${INVEST}`,
];

const SENSITIVE = new RegExp(`\\b${alt(SENSITIVE_TERMS)}\\b`, "i");

// Characters that take up no room on screen: soft hyphen, combining grapheme
// joiner, zero-width spaces and joiners, direction marks, word joiner, invisible
// operators, variation selectors, the byte order mark and the blank Hangul fillers.
const INVISIBLE =
  /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]/g;
// Combining marks on a plain Latin letter, such as a dot or accent added to one
// letter at a time. NFKD splits them off first. Marks on other scripts (Sinhala) stay.
const LATIN_MARKS = /([A-Za-z])[\u0300-\u036F]+/g;
// Cyrillic and Greek letters that look like the Latin letters the crisis
// phrases use. Folded to Latin for classification only.
const CONFUSABLES = new Map<string, string>([
  // Cyrillic
  ["\u0430", "a"],
  ["\u0435", "e"],
  ["\u0456", "i"],
  ["\u043E", "o"],
  ["\u0440", "p"],
  ["\u0441", "c"],
  ["\u0443", "y"],
  ["\u0445", "x"],
  ["\u043A", "k"],
  ["\u043C", "m"],
  ["\u0442", "t"],
  ["\u043D", "h"],
  ["\u0455", "s"],
  ["\u0458", "j"],
  ["\u0501", "d"],
  ["\u04BB", "h"],
  ["\u04CF", "l"],
  // Greek
  ["\u03BF", "o"],
  ["\u03B1", "a"],
  ["\u03B5", "e"],
  ["\u03B9", "i"],
  ["\u03BA", "k"],
  ["\u03BD", "v"],
  ["\u03C1", "p"],
  ["\u03C5", "u"],
  ["\u03C4", "t"],
  ["\u03C7", "x"],
  ["\u03F2", "c"],
]);
const CONFUSABLE_CHARS = new RegExp(
  `[${[...CONFUSABLES.keys()].join("")}]`,
  "g",
);

// What a spaced-out word reads as when the gaps are only gaps: only phrases
// that are unmistakable without word breaks.
const SQUASHED_SELF_HARM =
  /(?:kill|killing|hurt|hurting|harm|harming|cut|cutting|end|ending)(?:my|me)(?:own)?(?:self|life)|suicid|unaliv|(?:want|wanna)(?:to)?die/;

const WORD_PIECE = /[a-z0-9]+/g;
const GAP_CHARS = /^[ .\-_*]+$/;
const isSingleLetter = (piece: string) =>
  piece.length === 1 && piece >= "a" && piece <= "z";
// "a" and "i" are real words, so they never glue to the word next to them.
const glues = (piece: string) =>
  isSingleLetter(piece) && piece !== "a" && piece !== "i";
const isWord = (piece: string) => /^[a-z]+$/.test(piece);

interface Piece {
  text: string;
  start: number;
  end: number;
}

/**
 * Reads text whose letters are spread out, wholly or in part: "k i l l",
 * "kill m y s e l f", "s u icide", "k.i.l.l my self". Returns the text with
 * each run of single letters closed up into words, and the strings that the
 * pieces make when every gap is closed. Linear in the length of the text.
 */
function readSpacedLetters(folded: string): {
  closedUp: string;
  squashed: string[];
} {
  const pieces: Piece[] = [];
  for (const m of folded.matchAll(WORD_PIECE)) {
    pieces.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  // Only one to three separator characters between two pieces count as a gap.
  const gapBetween = (a: Piece, b: Piece) => {
    const width = b.start - a.end;
    return width >= 1 && width <= 3 ? folded.slice(a.end, b.start) : null;
  };
  const linked = (a: Piece, b: Piece) => {
    const gap = gapBetween(a, b);
    return gap !== null && GAP_CHARS.test(gap);
  };

  const squashed: string[] = [];
  const out: string[] = [];
  let copied = 0;

  // Whole runs of single letters: closed up into one string, and into words
  // where a gap of two or more separators marks a word break.
  for (let i = 0; i < pieces.length;) {
    if (!isSingleLetter(pieces[i].text)) {
      i++;
      continue;
    }
    let j = i;
    while (
      j + 1 < pieces.length &&
      isSingleLetter(pieces[j + 1].text) &&
      linked(pieces[j], pieces[j + 1])
    ) {
      j++;
    }
    if (j > i) {
      const words: string[] = [pieces[i].text];
      for (let k = i + 1; k <= j; k++) {
        const wide = pieces[k].start - pieces[k - 1].end >= 2;
        if (wide) words.push("");
        words[words.length - 1] += pieces[k].text;
      }
      out.push(folded.slice(copied, pieces[i].start), words.join(" "));
      copied = pieces[j].end;
      squashed.push(words.join(""));
    }
    i = j + 1;
  }
  out.push(folded.slice(copied));

  // Partly spread out words: single letters also join the whole word beside
  // them, so "k i l l myself" and "s u icide" close up.
  let unit = pieces.length > 0 ? pieces[0].text : "";
  let parts = 1;
  const flush = () => {
    if (parts > 1) squashed.push(unit);
  };
  for (let i = 1; i < pieces.length; i++) {
    const prev = pieces[i - 1];
    const next = pieces[i];
    const joins =
      linked(prev, next) &&
      ((isSingleLetter(prev.text) && isSingleLetter(next.text)) ||
        (glues(prev.text) && isWord(next.text)) ||
        (glues(next.text) && isWord(prev.text)));
    if (joins) {
      unit += next.text;
      parts++;
    } else {
      flush();
      unit = next.text;
      parts = 1;
    }
  }
  flush();

  return { closedUp: out.join(""), squashed };
}

/**
 * Folds the tricks that hide a phrase from the patterns: compatibility forms
 * (full-width letters), invisible characters, stray combining marks, Cyrillic
 * and Greek look-alike letters, curly quotes and letters spread out one at a
 * time. Classification only; the question itself is never changed.
 */
function prepare(question: string): { text: string; squashed: string[] } {
  const folded = question
    .normalize("NFKD")
    .replace(INVISIBLE, "")
    .replace(/[ \t]+/g, " ")
    .toLowerCase()
    .replace(CONFUSABLE_CHARS, (c) => CONFUSABLES.get(c) ?? c)
    .replace(LATIN_MARKS, "$1")
    .replace(/[\u2018\u2019\u02BC]/g, "'");
  const { closedUp, squashed } = readSpacedLetters(folded);
  return {
    text: closedUp === folded ? folded : `${folded}\n${closedUp}`,
    squashed,
  };
}

/** Keyword check, run before any model call. Crisis wins over sensitive. */
export function classifyQuestion(question: string): SafetyCategory {
  const { text, squashed } = prepare(question);
  if (isCrisis(text) || squashed.some((s) => SQUASHED_SELF_HARM.test(s))) {
    return "crisis";
  }
  if (SENSITIVE.test(text)) return "sensitive";
  return "none";
}

export const CRISIS_REPLY =
  "I'm really sorry you're going through this. I can't help with this through astrology, and you deserve real support right now. If you are in danger or thinking about harming yourself, please contact your local emergency number or a crisis line in your country, or reach out to someone you trust.";

export const SENSITIVE_INSTRUCTION =
  "The user is asking about a health, pregnancy, mental-health, legal or money topic. Say clearly that astrology cannot diagnose, predict or decide this, suggest speaking to a qualified professional, and only offer gentle reflective questions.";
