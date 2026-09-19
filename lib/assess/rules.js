/**
 * The rules that keep a peer assessment honest. Pure functions, tested.
 *
 * Decisions (10 Sep 2026): any tier can be appointed; an assessor may assess
 * any branch; two assessors may assess the same teacher in one semester and
 * both results stand, never averaged; an assessor can be assessed by another
 * assessor, but never by someone they assessed in the same semester; the
 * assessed teacher sees nothing; Semester 2 is the year's result with
 * Semester 1 shown alongside as progress.
 */

import { CRITERIA, isLevel, isCriterionKey } from "./rubric.js";

/**
 * May `assessorId` open an assessment of `teacherId` for this period?
 *
 * `reciprocalExists` answers: has teacherId already SUBMITTED an assessment of
 * assessorId in the same year and semester? The caller reads that from the
 * database; this function only decides.
 *
 * Returns { ok: true } or { ok: false, reason }.
 */
export function canAssess({ assessorId, teacherId, assessorIsAssessor, reciprocalExists }) {
  if (!assessorIsAssessor) return { ok: false, reason: "Only an appointed assessor can start an assessment." };
  if (!teacherId) return { ok: false, reason: "Choose a teacher." };
  if (assessorId === teacherId) return { ok: false, reason: "You cannot assess yourself." };
  if (reciprocalExists) {
    return {
      ok: false,
      reason: "That teacher assessed you this semester, so someone else has to assess them. Ask another assessor or an admin.",
    };
  }
  return { ok: true };
}

/**
 * Validate a batch of scores from the form. Unknown criteria and out-of-range
 * levels are rejected outright rather than silently dropped — a typo in the
 * client must never quietly lose a score. A null level means "unscored", which
 * is allowed on a draft and on submission (score only what was observed).
 */
export function validateScores(raw) {
  const errors = [];
  const scores = [];
  for (const [key, entry] of Object.entries(raw || {})) {
    if (!isCriterionKey(key)) {
      errors.push(`Unknown criterion ${key}.`);
      continue;
    }
    const level = entry?.level == null || entry.level === "" ? null : Number(entry.level);
    if (level !== null && !isLevel(level)) {
      errors.push(`${key}: level must be 1 to 5.`);
      continue;
    }
    const note = String(entry?.note ?? "").trim().slice(0, 1000);
    scores.push({ key, level, note });
  }
  return { ok: errors.length === 0, errors, scores };
}

/** An assessment can be submitted once at least one criterion carries a level. */
export function canSubmit(scores) {
  const scored = (scores || []).filter((s) => isLevel(s.level));
  if (scored.length === 0) return { ok: false, reason: "Score at least one criterion before submitting." };
  return { ok: true, scored: scored.length, total: CRITERIA.length };
}

/**
 * The year's picture for one teacher: per criterion, the Semester 2 levels
 * (final) and Semester 1 levels (progress), from every SUBMITTED assessment.
 * Multiple assessments in a semester are listed, not averaged.
 *
 * `assessments` are { semester, assessorName, scores: [{key, level}] }.
 */
export function annualView(assessments) {
  const byCriterion = {};
  for (const c of CRITERIA) byCriterion[c.key] = { s1: [], s2: [] };
  for (const a of assessments || []) {
    const bucket = a.semester === 2 ? "s2" : "s1";
    for (const s of a.scores || []) {
      if (!isCriterionKey(s.key) || !isLevel(s.level)) continue;
      byCriterion[s.key][bucket].push({ level: s.level, assessor: a.assessorName || "" });
    }
  }
  return byCriterion;
}

/**
 * How many criteria sit at or above the bar in the FINAL semester, counting
 * a criterion as "at bar" only if every Semester 2 score for it is at bar —
 * two assessors disagreeing is a conversation, not a pass.
 */
export function atBarCount(view, target) {
  let scored = 0;
  let atBar = 0;
  for (const c of CRITERIA) {
    const finals = view[c.key]?.s2 || [];
    if (!finals.length) continue;
    scored++;
    if (finals.every((s) => s.level >= target)) atBar++;
  }
  return { scored, atBar };
}
