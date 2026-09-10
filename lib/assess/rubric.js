/**
 * The peer-assessment rubric, as config.
 *
 * Same idea as PAY_TIERS in lib/hours/rates.js: the wording lives in one file,
 * the UI renders whatever is here, and nothing about it is in the database.
 * What IS in the database is which RUBRIC_VERSION a score was given against,
 * snapshotted on every score row — so editing a descriptor later never rewrites
 * the meaning of a result already on file. Bump RUBRIC_VERSION whenever a
 * descriptor changes in substance, not for typos.
 *
 * Decisions locked with Karim, 10 Sep 2026 (see the Decisions log on the
 * assessment page): five levels, ONE bar for every tier (level 3), no link to
 * pay, results are management-only, semesters are the two halves of the year.
 */

export const RUBRIC_VERSION = 1;

/** The bar every teacher is measured against, whatever their tier. */
export const TARGET_LEVEL = 3;

export const LEVELS = [
  { level: 1, name: "Beginning", short: "Not yet doing it, or doing it in a way that has to be undone." },
  { level: 2, name: "Developing", short: "Does it with help or reminders. Inconsistent across a lesson." },
  { level: 3, name: "Proficient", short: "The bar. Does it unaided, correctly, in the lesson observed." },
  { level: 4, name: "Accomplished", short: "Does it well and adapts to the children in front of them." },
  { level: 5, name: "Exemplary", short: "Others learn it from this teacher. The branch example." },
];

export const LEVEL_BY_NUMBER = Object.fromEntries(LEVELS.map((l) => [l.level, l]));

export function isLevel(v) {
  return Number.isInteger(v) && v >= 1 && v <= LEVELS.length;
}

/**
 * Four domains, grouped by what the assessor looks at. `evidence` is the
 * sentence shown under the domain heading on the scoring form, and `kinds`
 * says which evidence uploads make sense there (Phase 2). Domain B is scored
 * live and never recorded, by decision.
 */
export const DOMAINS = [
  {
    key: "A",
    name: "Portal and records",
    skills: "Skills 1, 2, 11, 12",
    evidence: "The portal's own record for the class, checked by the assessor on the day.",
    kinds: [],
  },
  {
    key: "B",
    name: "Quran competence",
    skills: "Skills 4 and 5, each split into tajweed, fluency, makhraj",
    evidence: "Assessor listens live and scores on the spot. Nothing is recorded.",
    kinds: [],
  },
  {
    key: "C",
    name: "Classroom teaching",
    skills: "Skills 3, 6, 7, 8",
    evidence: "Lesson video clips uploaded with the assessment, or live observation with notes.",
    kinds: ["video", "photo"],
  },
  {
    key: "D",
    name: "Class stewardship",
    skills: "Skills 9 and 10",
    evidence: "Photos before children arrive and after the room is reset, uploaded with the assessment.",
    kinds: ["photo"],
  },
];

export const DOMAIN_BY_KEY = Object.fromEntries(DOMAINS.map((d) => [d.key, d]));

/**
 * Sixteen criteria across Karim's twelve skills. `key` is what a score row
 * stores; never rename one once results exist. `skill` is his numbering.
 * Descriptors are indexed by level - 1.
 */
export const CRITERIA = [
  // ---- A · Portal and records ------------------------------------------
  {
    key: "A1",
    domain: "A",
    skill: 1,
    name: "Student details in the portal",
    how: "Assessor opens the teacher's class in My classes.",
    levels: [
      "Cannot find the class roster, or students are missing, misnamed, or in the wrong class.",
      "Adds a student with help. Level or notes often left blank and an admin has to correct it.",
      "Adds and updates own students unaided. Name, class, level and notes are right at the time of the check.",
      "Roster is current within the week a child joins, moves or leaves. Spots and fixes a colleague's stale entry.",
      "Roster is always right without prompting. Shows newer teachers how to keep theirs correct.",
    ],
  },
  {
    key: "A2",
    domain: "A",
    skill: 2,
    name: "After-lesson report for parents",
    how: "Assessor reads the last four reports for the class.",
    levels: [
      "No report after observed lessons, or one line with nothing a parent can use.",
      "Written late or only sometimes. Says what was taught but not how the class did or what to practise at home.",
      "Written the same day. Names the surah and ayat covered, how the class went, and one thing to practise at home.",
      "Same-day report with a per-child line where it matters, in warm plain language. No jargon.",
      "Reports parents mention by name. Specific, encouraging, honest about what needs work, every lesson.",
    ],
  },
  {
    key: "A3",
    domain: "A",
    skill: 11,
    name: "Retrieving lesson plans",
    how: "Lesson Packs in the portal. Assessor asks which pack the lesson came from.",
    levels: [
      "Teaches without opening the Lesson Pack for the portion, or does not know where packs are.",
      "Finds the pack when reminded. Opens it during the lesson rather than before.",
      "Opens the approved pack for the day's portion before class and teaches from it, including its tajweed points.",
      "Prepares from the pack and adapts pacing to the age group in the room without leaving the plan.",
      "Plans the week ahead from packs and flags a missing portion to reviewers before it is needed.",
    ],
  },
  {
    key: "A4",
    domain: "A",
    skill: 12,
    name: "Modifying lesson plans",
    how: "Proposed pack edits in the portal, and what changed in the lesson.",
    levels: [
      "Never proposes a change, or changes what is taught without recording it anywhere.",
      "Notices when a pack does not fit the class but does not propose an edit.",
      "Proposes a specific edit when a lesson shows it is needed, with a reason.",
      "Proposals are precise (which step, which age group, what to change) and are usually approved as written.",
      "Proposals improve packs for every branch. Reviewers ask this teacher to look at new packs.",
    ],
  },

  // ---- B · Quran competence --------------------------------------------
  {
    key: "B1",
    domain: "B",
    skill: 4,
    name: "Reading · tajweed",
    how: "Reads one page from juz amma, chosen by the assessor, from the mushaf.",
    levels: [
      "Frequent errors throughout: mad lengths, ghunnah and qolqolah missed.",
      "Knows the rules but applies them inconsistently. Several errors on the page.",
      "Reads the page with at most one or two minor slips, none that change meaning.",
      "Tajweed correct throughout, including idgham, ikhfa and mad lengths at normal pace.",
      "Tajweed correct and can name the rule for any word the assessor points to.",
    ],
  },
  {
    key: "B2",
    domain: "B",
    skill: 4,
    name: "Reading · fluency",
    how: "Same page. Pace, stops, restarts.",
    levels: [
      "Halting, letter by letter, long pauses, frequent restarts.",
      "Reads word by word. Loses place at waqf marks.",
      "Reads smoothly at a teaching pace, observes waqf marks, rarely restarts.",
      "Confident rhythm and stops, and can slow down clearly for children to follow.",
      "Fluent at any pace, with a clear voice that models what children should copy.",
    ],
  },
  {
    key: "B3",
    domain: "B",
    skill: 4,
    name: "Reading · makhraj",
    how: "Same page. Assessor may ask for ع ح ق ط ض ص ذ ث in isolation.",
    levels: [
      "Several letters from the wrong place. Throat and heavy letters confused with their neighbours.",
      "Most letters correct. The heavy and throat letters are inconsistent.",
      "All 28 letters from the correct makhraj at teaching pace. Heavy letters clearly distinguished.",
      "Makhraj correct at speed, and sifat (heavy, light, whispered) are audible.",
      "Precise enough to demonstrate any letter in isolation for a child and correct a child's mistake.",
    ],
  },
  {
    key: "B4",
    domain: "B",
    skill: 5,
    name: "Recitation · tajweed",
    how: "From memory. Assessor names any surah from An-Naba to An-Nas.",
    levels: [
      "Cannot recite the chosen surah from memory, or recites with many tajweed errors.",
      "Recites with prompts. Slips in mad and ghunnah.",
      "Recites any surah in juz amma from memory with tajweed intact.",
      "Correct tajweed, and can start from any ayah the assessor names.",
      "Recites the whole juz with correct tajweed and catches a child's error mid-recitation.",
    ],
  },
  {
    key: "B5",
    domain: "B",
    skill: 5,
    name: "Recitation · fluency",
    how: "Same surah. Prompts needed, rhythm, stops between ayat.",
    levels: [
      "Frequent stalls. Needs the first words of most ayat.",
      "Completes the surah with a few prompts.",
      "Recites smoothly without prompts, with clear stops between ayat.",
      "Steady rhythm and a tune children can follow, at the pace used in class.",
      "Leads group recitation with a voice that carries and keeps the class in time.",
    ],
  },
  {
    key: "B6",
    domain: "B",
    skill: 5,
    name: "Recitation · makhraj",
    how: "Same surah.",
    levels: [
      "Makhraj errors from memory, especially the throat and heavy letters.",
      "Mostly correct. Slips when the pace rises.",
      "Makhraj correct throughout the surah at class pace.",
      "Makhraj and sifat correct even in long or fast ayat.",
      "Recites with makhraj a child can copy, and shows the difference between confusable letters on request.",
    ],
  },

  // ---- C · Classroom teaching ------------------------------------------
  {
    key: "C1",
    domain: "C",
    skill: 3,
    name: "Handling children",
    how: "Whole lesson. Routine, attention, safety, tone.",
    levels: [
      "Loses the class: shouting, children leaving seats, no routine. Or a child left unattended.",
      "Keeps order only with constant reminders. Has a routine but drops it under pressure.",
      "Opens with the routine songs, keeps every child in sight and engaged, corrects gently, no child left out.",
      "Anticipates trouble: moves an unsettled child, changes activity before attention drops. Warm and firm.",
      "Children want to be in this class. Calm authority, no raised voice, each child known by name and need.",
    ],
  },
  {
    key: "C2",
    domain: "C",
    skill: 6,
    name: "Teaching juz amma the LQK way",
    how: "Hear, see, do. Songs to open, pairs from slides or cards, an activity, revision to close.",
    levels: [
      "Reads the verses at the class. No song, no slides or cards, no actions. Children only listen.",
      "One mode only, usually hearing. Slides or cards present but not used. No doing activity.",
      "All three modes in the lesson: hear (teacher recites, children echo), see (verse slides or cards with Arabic, transliteration and meaning), do (action cues, writing, huruf search or word wheel). Ends with revision.",
      "Modes in proportion to the age: songs and flashcards for 3 to 4 year olds, writing and huruf search for older ones. Checks each child before moving on.",
      "Teaches the LQK sequence without notes, adapts the activity on the spot, and makes revision weeks feel like games.",
    ],
  },
  {
    key: "C3",
    domain: "C",
    skill: 7,
    name: "Teaching solat",
    how: "A solat segment. Positions, names, readings, saf.",
    levels: [
      "Demonstrates with errors of position or order. Children copy the mistakes.",
      "Correct sequence but no explanation of what each part is called or why.",
      "Demonstrates each position correctly, names it, recites its reading, and has children copy in a proper saf.",
      "Teaches wudu and solat as one routine, corrects posture one child at a time, ties readings to what children recite.",
      "Leads a class solat the children perform without prompts, and explains meaning in words a child keeps.",
    ],
  },
  {
    key: "C4",
    domain: "C",
    skill: 8,
    name: "Teaching adab",
    how: "Whole lesson. What is modelled and what is named.",
    levels: [
      "No adab taught, or the teacher's own adab (phone, tone, dress) undermines it.",
      "Mentions adab as rules only when a child misbehaves.",
      "Models adab throughout: salam, bismillah to begin, du'a to close, respect for the mushaf, listening while others recite. Names the adab being practised.",
      "Weaves one adab point into every lesson with a story or example children repeat at home.",
      "Children practise adab unprompted and parents comment on it. The example the branch points to.",
    ],
  },

  // ---- D · Class stewardship -------------------------------------------
  {
    key: "D1",
    domain: "D",
    skill: 9,
    name: "Cleaning the class after the lesson",
    how: "Photo of the room five minutes after the lesson ends.",
    levels: [
      "Materials on the floor, chairs out, whiteboard uncleaned.",
      "Partly tidied. The next teacher has to finish.",
      "Chairs and tables back, whiteboard clean, floor clear, full bins emptied, within five minutes of the lesson ending.",
      "Room reset and mushafs and cards returned to their places without being asked.",
      "Room reset and the children helped through a tidy-up routine as part of the lesson.",
    ],
  },
  {
    key: "D2",
    domain: "D",
    skill: 10,
    name: "Organising learning materials",
    how: "Photo of the day's set before the lesson, and the shelf after.",
    levels: [
      "Cannot find the day's slides, cards or flashcards. Borrows from another class.",
      "Materials found but out of order, or the wrong card set for the lesson.",
      "Cards, flashcards and slides for the day's lesson set are ready before children arrive, and go back into the labelled set after.",
      "Keeps the branch's card sets complete and in order, and reports missing or damaged ones.",
      "Improves the system: labelling, storage and a checklist other teachers adopt.",
    ],
  },
];

export const CRITERION_BY_KEY = Object.fromEntries(CRITERIA.map((c) => [c.key, c]));

export function isCriterionKey(key) {
  return Object.prototype.hasOwnProperty.call(CRITERION_BY_KEY, String(key));
}

/** Criteria grouped under their domain, in rubric order — what the form renders. */
export function criteriaByDomain() {
  return DOMAINS.map((d) => ({ ...d, criteria: CRITERIA.filter((c) => c.domain === d.key) }));
}
