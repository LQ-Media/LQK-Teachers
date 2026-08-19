/* The extra details an event asks for at check-in.

   Karim's events differ — one needs a dietary note, another needs a car plate,
   another needs nothing at all — so the questions are HIS to define per event
   rather than a fixed set of columns. Stored as JSON on the event row and
   answered into JSON on the registration; this module is the only door in and
   out of both, so a malformed definition can never reach a live door page.

   Pure and dependency-free: the studio validates a draft in the browser and
   the action validates it again on the server, and both must agree. */

export const FIELD_TYPES = ["text", "tel", "email", "choice", "yesno", "note"];

const MAX_FIELDS = 12;
const MAX_LABEL = 80;
const MAX_OPTIONS = 12;
const MAX_ANSWER = 300;

function slugId(label, index) {
  const base = String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return base || `field-${index + 1}`;
}

/** Clamp a field list from anywhere into something safe to render. */
export function parseFields(json) {
  let raw;
  try {
    raw = typeof json === "string" ? JSON.parse(json || "[]") : json;
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const seen = new Set();
  const out = [];
  raw.slice(0, MAX_FIELDS).forEach((field, index) => {
    const label = String(field?.label || "").trim().slice(0, MAX_LABEL);
    if (!label) return;
    const type = FIELD_TYPES.includes(field?.type) ? field.type : "text";

    // Ids are stable across an edit so answers already collected keep pointing
    // at the right question. Collisions get a suffix rather than silently
    // overwriting a different question's answers.
    let id = String(field?.id || "").trim() || slugId(label, index);
    while (seen.has(id)) id = `${id}-${index}`;
    seen.add(id);

    const options =
      type === "choice"
        ? (Array.isArray(field?.options) ? field.options : [])
            .map((o) => String(o || "").trim())
            .filter(Boolean)
            .slice(0, MAX_OPTIONS)
        : [];

    // A choice with no options is an unanswerable question; it becomes a text
    // box rather than a dropdown a parent cannot get past.
    out.push({
      id,
      label,
      type: type === "choice" && options.length === 0 ? "text" : type,
      options,
      required: Boolean(field?.required),
    });
  });
  return out;
}

export function serializeFields(fields) {
  return JSON.stringify(parseFields(fields));
}

/** Answers, clamped to the questions that actually exist. */
export function parseAnswers(json) {
  try {
    const raw = typeof json === "string" ? JSON.parse(json || "{}") : json;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

/**
 * Validate a submitted answer set against the event's fields.
 * @returns {{ ok: true, answers: object } | { ok: false, error: string }}
 */
export function validateAnswers(fields, submitted) {
  const answers = {};
  const given = parseAnswers(submitted);

  for (const field of fields) {
    let value = given[field.id];
    value = value === undefined || value === null ? "" : String(value).trim().slice(0, MAX_ANSWER);

    if (field.type === "yesno") value = value === "yes" ? "yes" : value === "no" ? "no" : "";
    // An answer that isn't one of the offered options is dropped rather than
    // stored: the only way to produce one is to edit the page.
    if (field.type === "choice" && value && !field.options.includes(value)) value = "";

    if (field.required && !value) {
      return { ok: false, error: `Please answer “${field.label}”.` };
    }
    if (value) answers[field.id] = value;
  }
  return { ok: true, answers };
}

/** Answers paired with their question, for a staff table or a CSV export. */
export function answerRows(fields, json) {
  const answers = parseAnswers(json);
  return fields
    .map((field) => ({ label: field.label, value: answers[field.id] || "" }))
    .filter((row) => row.value);
}
