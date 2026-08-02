/**
 * Build the recall check from an ayah's own words.
 *
 * Pure and deterministic — no AI, no authored question bank, and no
 * Math.random, so every teacher gets the identical quiz for the day and a
 * re-render never reshuffles the options mid-question.
 *
 * Distractors are the *other words of the same ayah*, which makes the check
 * meaningfully harder than generic multiple choice: the wrong answers are all
 * plausible, related meanings rather than obvious filler.
 *
 * Client-safe (no server-only import) so the component can use it directly.
 */
export const MIN_WORDS_FOR_QUIZ = 3;
export const MAX_QUESTIONS = 5;

export function buildQuestions(words) {
  const unique = [];
  const seen = new Set();
  for (const w of words || []) {
    const meaning = String(w?.meaning || "").trim();
    if (!meaning) continue;
    const norm = meaning.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    unique.push(w);
  }

  // A two-word ayah cannot produce a fair multiple choice — better to say so
  // than to serve a question with one distractor.
  if (unique.length < MIN_WORDS_FOR_QUIZ) return [];

  return unique.slice(0, MAX_QUESTIONS).map((w, i) => {
    const others = unique.filter((o) => o !== w).map((o) => o.meaning);

    // Rotate the distractor window per question so a short ayah doesn't show
    // the same two wrong answers every time.
    const distractors = [];
    for (let k = 0; k < others.length && distractors.length < 2; k++) {
      const candidate = others[(i + k) % others.length];
      if (!distractors.includes(candidate)) distractors.push(candidate);
    }

    // Deterministic placement of the correct answer, varied by question index
    // so it isn't always in the same slot.
    const options = [...distractors];
    options.splice(i % (options.length + 1), 0, w.meaning);

    return { word: w.arabic, answer: w.meaning, options };
  });
}
