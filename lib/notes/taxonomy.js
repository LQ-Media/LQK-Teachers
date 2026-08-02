/**
 * Shared vocabulary for the Ilmu Bank. Framework-agnostic (no server-only
 * import) so both the browse page and the client-side share form can use it.
 *
 * Deliberately a short, fixed list rather than free-text tags: a library of
 * forty teachers' notes is only searchable if everyone files things the same
 * way, and free tags drift within a term.
 */

export const TOPICS = [
  "Aqidah",
  "Akhlak",
  "Fiqh",
  "Sirah",
  "Tafsir",
  "Hadith",
  "Tajwid",
  "Hafazan method",
  "Classroom practice",
  "Other",
];

export const AGE_GROUPS = [
  { key: "all", label: "Any age" },
  { key: "4-6", label: "4–6 years" },
  { key: "7-9", label: "7–9 years" },
  { key: "10-12", label: "10–12 years" },
  { key: "adult", label: "Teachers / adults" },
];

export function ageLabel(key) {
  return AGE_GROUPS.find((a) => a.key === key)?.label ?? "Any age";
}

export function isTopic(value) {
  return TOPICS.includes(value);
}

export function isAgeGroup(value) {
  return AGE_GROUPS.some((a) => a.key === value);
}
