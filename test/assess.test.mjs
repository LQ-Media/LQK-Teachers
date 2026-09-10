// Peer assessment: the calendar, the rules, the rubric's own integrity, and
// the database guarantees behind them. The pure half runs under UTC and SGT
// alike; the integration half builds a real database with ensureSchema in a
// temp directory, because "a submitted result survives its assessor's account
// being deleted" is a foreign-key property, not something a mock can prove.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { CRITERIA, DOMAINS, LEVELS, TARGET_LEVEL, RUBRIC_VERSION, isCriterionKey, criteriaByDomain } from "../lib/assess/rubric.js";
import { periodFor, periodBounds, deadlineStatus, deadlineFor, isDateString, yearOptions } from "../lib/assess/periods.js";
import { canAssess, validateScores, canSubmit, annualView, atBarCount } from "../lib/assess/rules.js";

// ---- rubric integrity --------------------------------------------------

describe("rubric config", () => {
  test("sixteen criteria, five descriptors each, every key unique", () => {
    assert.equal(CRITERIA.length, 16);
    assert.equal(new Set(CRITERIA.map((c) => c.key)).size, 16);
    for (const c of CRITERIA) {
      assert.equal(c.levels.length, LEVELS.length, `${c.key} has ${c.levels.length} descriptors`);
      assert.ok(c.levels.every((t) => t.trim().length > 20), `${c.key} has a thin descriptor`);
      assert.ok(DOMAINS.some((d) => d.key === c.domain), `${c.key} points at a missing domain`);
    }
  });

  test("Karim's twelve skills are all covered, and only those", () => {
    const skills = new Set(CRITERIA.map((c) => c.skill));
    assert.deepEqual([...skills].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // Reading (4) and recitation (5) are the ones split three ways.
    assert.equal(CRITERIA.filter((c) => c.skill === 4).length, 3);
    assert.equal(CRITERIA.filter((c) => c.skill === 5).length, 3);
  });

  test("one bar for everyone: level 3 of five", () => {
    assert.equal(LEVELS.length, 5);
    assert.equal(TARGET_LEVEL, 3);
    assert.equal(RUBRIC_VERSION, 1);
  });

  test("domain B is scored live: no evidence kinds", () => {
    const b = DOMAINS.find((d) => d.key === "B");
    assert.deepEqual(b.kinds, []);
    assert.deepEqual(criteriaByDomain().map((d) => d.criteria.length), [4, 6, 4, 2]);
  });

  test("isCriterionKey is exact and ignores prototype keys", () => {
    assert.equal(isCriterionKey("C2"), true);
    assert.equal(isCriterionKey("c2"), false);
    assert.equal(isCriterionKey("toString"), false);
  });
});

// ---- calendar ----------------------------------------------------------

describe("semesters are the two halves of the year", () => {
  test("January to June is Semester 1, July to December is Semester 2", () => {
    assert.deepEqual(periodFor("2026-01-01"), { year: 2026, semester: 1 });
    assert.deepEqual(periodFor("2026-06-30"), { year: 2026, semester: 1 });
    assert.deepEqual(periodFor("2026-07-01"), { year: 2026, semester: 2 });
    assert.deepEqual(periodFor("2026-12-31"), { year: 2026, semester: 2 });
  });

  test("bounds are inclusive and match periodFor at every edge", () => {
    for (const [y, s] of [[2026, 1], [2026, 2], [2027, 1]]) {
      const { from, to } = periodBounds(y, s);
      assert.deepEqual(periodFor(from), { year: y, semester: s });
      assert.deepEqual(periodFor(to), { year: y, semester: s });
    }
    assert.throws(() => periodBounds(2026, 3));
  });

  test("dates are validated as calendar dates, not just shaped strings", () => {
    assert.equal(isDateString("2026-02-29"), false, "2026 is not a leap year");
    assert.equal(isDateString("2028-02-29"), true);
    assert.equal(isDateString("2026-13-01"), false);
    assert.equal(isDateString("26-01-01"), false);
    assert.throws(() => periodFor("2026-02-30"));
  });
});

describe("the November rule", () => {
  test("done once anything is on file, whatever the date", () => {
    assert.equal(deadlineStatus({ today: "2026-12-15", year: 2026, hasAssessment: true }), "done");
  });

  test("nobody is chased before October", () => {
    assert.equal(deadlineStatus({ today: "2026-09-30", year: 2026, hasAssessment: false }), "open");
  });

  test("chased from 1 October up to and including 30 November", () => {
    assert.equal(deadlineStatus({ today: "2026-10-01", year: 2026, hasAssessment: false }), "chase");
    assert.equal(deadlineStatus({ today: "2026-11-30", year: 2026, hasAssessment: false }), "chase");
  });

  test("missed from 1 December, and for any past year", () => {
    assert.equal(deadlineStatus({ today: "2026-12-01", year: 2026, hasAssessment: false }), "missed");
    assert.equal(deadlineStatus({ today: "2027-03-01", year: 2026, hasAssessment: false }), "missed");
  });

  test("a future year is simply open", () => {
    assert.equal(deadlineStatus({ today: "2026-12-01", year: 2027, hasAssessment: false }), "open");
    assert.equal(deadlineFor(2027), "2027-11-30");
  });

  test("year picker: this year first, then every year with data, no repeats", () => {
    assert.deepEqual(yearOptions(2026, [2025, 2026, 2024]), [2026, 2025, 2024]);
    assert.deepEqual(yearOptions(2026, []), [2026]);
  });
});

// ---- rules -------------------------------------------------------------

describe("who may assess whom", () => {
  const base = { assessorId: "a", teacherId: "t", assessorIsAssessor: true, reciprocalExists: false };

  test("an appointed assessor may assess any other teacher", () => {
    assert.deepEqual(canAssess(base), { ok: true });
  });
  test("never yourself", () => {
    assert.equal(canAssess({ ...base, teacherId: "a" }).ok, false);
  });
  test("never someone who assessed you this semester", () => {
    assert.equal(canAssess({ ...base, reciprocalExists: true }).ok, false);
  });
  test("never without the flag", () => {
    assert.equal(canAssess({ ...base, assessorIsAssessor: false }).ok, false);
  });
});

describe("scores from the form", () => {
  test("levels 1–5 pass, null means not observed, anything else is rejected", () => {
    const r = validateScores({ A1: { level: 3, note: " fine " }, A2: { level: null }, B1: { level: "" } });
    assert.equal(r.ok, true);
    assert.deepEqual(r.scores, [
      { key: "A1", level: 3, note: "fine" },
      { key: "A2", level: null, note: "" },
      { key: "B1", level: null, note: "" },
    ]);
    assert.equal(validateScores({ A1: { level: 6 } }).ok, false);
    assert.equal(validateScores({ A1: { level: 0 } }).ok, false);
    assert.equal(validateScores({ ZZ: { level: 3 } }).ok, false, "unknown criteria are an error, not dropped");
  });

  test("notes are capped, never truncated silently below a sentence", () => {
    const r = validateScores({ A1: { level: 2, note: "x".repeat(5000) } });
    assert.equal(r.scores[0].note.length, 1000);
  });

  test("submitting needs at least one score; unscored criteria are fine", () => {
    assert.equal(canSubmit([]).ok, false);
    assert.equal(canSubmit([{ key: "A1", level: null }]).ok, false);
    assert.deepEqual(canSubmit([{ key: "A1", level: 4 }]), { ok: true, scored: 1, total: 16 });
  });
});

describe("the annual view", () => {
  const s1 = { semester: 1, assessorName: "Nurul", scores: [{ key: "C2", level: 2 }] };
  const s2a = { semester: 2, assessorName: "Nurul", scores: [{ key: "C2", level: 3 }, { key: "C1", level: 4 }] };
  const s2b = { semester: 2, assessorName: "Firdaus", scores: [{ key: "C2", level: 2 }] };

  test("Semester 2 is final, Semester 1 sits beside it; two assessors are listed, not averaged", () => {
    const v = annualView([s1, s2a, s2b]);
    assert.deepEqual(v.C2.s1, [{ level: 2, assessor: "Nurul" }]);
    assert.deepEqual(v.C2.s2, [
      { level: 3, assessor: "Nurul" },
      { level: 2, assessor: "Firdaus" },
    ]);
    assert.deepEqual(v.A1, { s1: [], s2: [] });
  });

  test("at bar only when every Semester 2 score for the criterion is at bar", () => {
    const v = annualView([s1, s2a, s2b]);
    assert.deepEqual(atBarCount(v, TARGET_LEVEL), { scored: 2, atBar: 1 }); // C1 yes, C2 split
  });

  test("garbage levels and keys are ignored rather than crashing the admin page", () => {
    const v = annualView([{ semester: 2, scores: [{ key: "nope", level: 3 }, { key: "A1", level: 9 }] }]);
    assert.deepEqual(v.A1, { s1: [], s2: [] });
  });
});

// ---- database guarantees ------------------------------------------------

describe("database", () => {
  let dir;
  let db;
  let teacher;
  let assessor;

  before(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "lqk-assess-"));
    process.env.LQK_DATA_DIR = dir;
    process.env.NODE_ENV = "production"; // no demo seed
    ({ getDb: undefined });
    const mod = await import("../lib/db.js");
    db = mod.getDb();
    const ins = db.prepare(
      "INSERT INTO profiles (id, full_name, email, password_hash, role, primary_location, is_assessor, created_at) VALUES (?, ?, ?, 'x', 'teacher', 'Woods Square', ?, ?)"
    );
    teacher = randomUUID();
    assessor = randomUUID();
    ins.run(teacher, "Siti Aminah", "siti@example.com", 0, new Date().toISOString());
    ins.run(assessor, "Nurul Huda", "nurul@example.com", 1, new Date().toISOString());
  });

  after(() => {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
    rmSync(dir, { recursive: true, force: true });
  });

  function insertAssessment(over = {}) {
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO assessments (id, teacher_id, assessor_id, year, semester, observed_on, status, rubric_version, created_at, updated_at)
       VALUES (?, ?, ?, 2026, 2, '2026-09-10', 'submitted', 1, ?, ?)`
    ).run(id, over.teacher || teacher, over.assessor || assessor, now, now);
    return id;
  }

  test("is_assessor defaults to 0 for existing accounts", () => {
    const row = db.prepare("SELECT is_assessor FROM profiles WHERE id = ?").get(teacher);
    assert.equal(row.is_assessor, 0);
  });

  test("a score row is one per criterion, level 1–5 only", () => {
    const id = insertAssessment();
    const ins = db.prepare("INSERT INTO assessment_scores (assessment_id, criterion_key, level, note) VALUES (?, ?, ?, NULL)");
    ins.run(id, "A1", 3);
    assert.throws(() => ins.run(id, "A1", 4), /UNIQUE|PRIMARY/i, "same criterion twice");
    assert.throws(() => ins.run(id, "A2", 6), /CHECK/i);
    assert.throws(() => ins.run(id, "A2", 0), /CHECK/i);
  });

  test("a submitted result outlives its assessor's account, and dies with its teacher's", () => {
    const other = randomUUID();
    db.prepare(
      "INSERT INTO profiles (id, full_name, email, password_hash, role, is_assessor, created_at) VALUES (?, 'Temp Assessor', 'temp@example.com', 'x', 'teacher', 1, ?)"
    ).run(other, new Date().toISOString());
    const id = insertAssessment({ assessor: other });
    db.prepare("INSERT INTO assessment_scores (assessment_id, criterion_key, level) VALUES (?, 'C2', 3)").run(id);

    // Deleting the assessor without detaching is refused (no ON DELETE) —
    // that is what forces lib/actions/admin.js to NULL assessor_id first.
    assert.throws(() => db.prepare("DELETE FROM profiles WHERE id = ?").run(other), /FOREIGN KEY/i);
    db.prepare("UPDATE assessments SET assessor_id = NULL WHERE assessor_id = ?").run(other);
    db.prepare("DELETE FROM profiles WHERE id = ?").run(other);
    assert.ok(db.prepare("SELECT 1 FROM assessments WHERE id = ?").get(id), "result kept");

    // The teacher's own results cascade.
    const gone = randomUUID();
    db.prepare(
      "INSERT INTO profiles (id, full_name, email, password_hash, role, created_at) VALUES (?, 'Leaving Teacher', 'leaving@example.com', 'x', 'teacher', ?)"
    ).run(gone, new Date().toISOString());
    const id2 = insertAssessment({ teacher: gone });
    db.prepare("INSERT INTO assessment_scores (assessment_id, criterion_key, level) VALUES (?, 'C2', 3)").run(id2);
    db.prepare("DELETE FROM profiles WHERE id = ?").run(gone);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM assessments WHERE id = ?").get(id2).n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM assessment_scores WHERE assessment_id = ?").get(id2).n, 0);
  });

  test("one verbal review per teacher per year", () => {
    const ins = db.prepare(
      "INSERT INTO assessment_reviews (id, teacher_id, year, reviewed_by, reviewed_on, note, created_at) VALUES (?, ?, 2026, ?, '2026-12-05', NULL, ?)"
    );
    ins.run(randomUUID(), teacher, assessor, new Date().toISOString());
    assert.throws(() => ins.run(randomUUID(), teacher, assessor, new Date().toISOString()), /UNIQUE/i);
  });

  test("one social identity per provider account, and it goes with the profile", () => {
    const ins = db.prepare(
      "INSERT INTO auth_identities (id, profile_id, provider, provider_subject, email, created_at) VALUES (?, ?, 'google', 'sub-1', 'siti@example.com', ?)"
    );
    ins.run(randomUUID(), teacher, new Date().toISOString());
    assert.throws(() => ins.run(randomUUID(), assessor, new Date().toISOString()), /UNIQUE/i, "same Google account twice");
    assert.throws(
      () => db.prepare("INSERT INTO auth_identities (id, profile_id, provider, provider_subject, created_at) VALUES (?, ?, 'apple', 'x', ?)").run(randomUUID(), teacher, new Date().toISOString()),
      /CHECK/i
    );
  });
});
