import { normalizePhone } from "./phone";

/* Custom reply fields — the questions Karim adds to an event on top of the
   built-in ones (attending, headcount, decline reason, photo, message).

   Client-safe on purpose: the admin builder and the guest form are both client
   components and both need the same type list and the same validator, so a
   field that looks valid while you're building it cannot fail at reply time.

   THE SAME SHAPE OF HARDENING AS theme.js: `sanitizeFields()` is the only door
   in. Whatever is in `custom_fields_json` — hand-edited, half-migrated, or
   written by an older version of this file — comes out as a renderable array or
   an empty one. A malformed field definition must never be able to break a
   guest's invitation, because the guest cannot fix it and the event is tonight.

   TWO SCOPES:
   - "family": asked once per reply. Answers land in event_rsvps.custom_json as
     {fieldId: answer}.
   - "attendee": repeated for every person the family is bringing. Answers land
     in event_rsvps.attendees_json as [{fieldId: answer}, …], one entry per
     head, in party order (adults first, then children). */

export const MAX_FIELDS = 24;
export const MAX_OPTIONS = 40;
export const MAX_LABEL = 120;
export const MAX_ANSWER = 2000;
/* Per-attendee blocks are rendered one per head. Past this many the reply form
   stops being a form and becomes data entry — the family gets the built-in
   "names of those joining you" box instead, and the block is skipped. */
export const MAX_ATTENDEE_BLOCKS = 30;

/* type → how it renders, how it validates, and what an empty answer looks like.
   `multiple: true` means the answer is an array; everything else is a string. */
export const FIELD_TYPES = {
  text: { label: "Short text", hint: "One line — a name, a room number" },
  textarea: { label: "Long text", hint: "A paragraph box" },
  select: { label: "Dropdown", hint: "Pick one of your options", hasOptions: true },
  multi: { label: "Tick all that apply", hint: "Several of your options", hasOptions: true, multiple: true },
  checkbox: { label: "Yes / no tickbox", hint: "A single agreement or opt-in" },
  number: { label: "Number", hint: "Digits only" },
  date: { label: "Date", hint: "A date picker" },
  phone: { label: "Phone", hint: "Checked and stored as +65…" },
  email: { label: "Email", hint: "Format-checked" },
  file: { label: "Photo upload", hint: "Images only — goes to the event's Drive folder" },
};

export const FIELD_TYPE_KEYS = Object.keys(FIELD_TYPES);

export function isFieldType(type) {
  return Object.prototype.hasOwnProperty.call(FIELD_TYPES, type);
}

export function fieldTakesOptions(type) {
  return !!FIELD_TYPES[type]?.hasOptions;
}

export function fieldIsMultiple(type) {
  return !!FIELD_TYPES[type]?.multiple;
}

/* Short, collision-resistant, and readable in a CSV header. Not a security
   token — it only has to be unique within one event's field list. */
export function newFieldId(existing = []) {
  const taken = new Set(existing.map((f) => f?.id));
  for (let i = 0; i < 1000; i += 1) {
    const id = `f${Math.random().toString(36).slice(2, 8)}`;
    if (!taken.has(id)) return id;
  }
  return `f${Date.now().toString(36)}`;
}

/* Strips control characters and the bidi overrides that can make a pasted
   label render as something other than what it says, then trims. */
function cleanText(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .trim()
    .slice(0, max);
}

/* ---- definitions -------------------------------------------------------- */

/* Accepts the JSON string from the column, an already-parsed array, or junk.
   ALWAYS returns an array — never null, never throws. Fields that can't be
   repaired (no label, unknown type, a dropdown with no options) are dropped
   rather than rendered broken: a question a guest can't answer is worse than a
   question that isn't asked. */
export function sanitizeFields(input) {
  let raw = input;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];

  const out = [];
  const seen = new Set();

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    if (out.length >= MAX_FIELDS) break;

    const type = isFieldType(item.type) ? item.type : "text";
    const label = cleanText(item.label, MAX_LABEL);
    if (!label) continue;

    let id = cleanText(item.id, 24).replace(/[^A-Za-z0-9_-]/g, "");
    if (!id || seen.has(id)) id = newFieldId(out);
    seen.add(id);

    let options = [];
    if (fieldTakesOptions(type)) {
      const list = Array.isArray(item.options) ? item.options : [];
      const uniq = new Set();
      for (const opt of list) {
        const text = cleanText(opt, MAX_LABEL);
        if (!text || uniq.has(text)) continue;
        uniq.add(text);
        options.push(text);
        if (options.length >= MAX_OPTIONS) break;
      }
      // A dropdown with nothing to choose from is unanswerable.
      if (!options.length) continue;
    }

    const scope = item.scope === "attendee" ? "attendee" : "family";

    out.push({
      id,
      type,
      label,
      hint: cleanText(item.hint, 160),
      required: !!item.required,
      scope,
      // Per-person questions only make sense for a family that's coming, so
      // attendee scope pins `when` rather than trusting whatever was stored.
      when: scope === "attendee" ? "yes" : item.when === "any" ? "any" : "yes",
      options,
    });
  }

  return out;
}

export function familyFields(fields, attending) {
  return sanitizeFields(fields).filter(
    (f) => f.scope === "family" && (f.when === "any" || attending === "yes")
  );
}

export function attendeeFields(fields) {
  return sanitizeFields(fields).filter((f) => f.scope === "attendee");
}

export function hasCustomFields(fields) {
  return sanitizeFields(fields).length > 0;
}

/* ---- answers ------------------------------------------------------------ */

export function emptyAnswer(field) {
  if (fieldIsMultiple(field.type)) return [];
  if (field.type === "checkbox") return false;
  return "";
}

export function isBlank(field, value) {
  if (fieldIsMultiple(field.type)) return !Array.isArray(value) || value.length === 0;
  if (field.type === "checkbox") return !value;
  return !String(value ?? "").trim();
}

/* Coerce one answer to its stored form, or return {error} with a translation
   key from lib/events/i18n.js. Runs on the client for live feedback and again
   on the server, where it is the authority — a guest can post anything. */
export function coerceAnswer(field, value) {
  if (isBlank(field, value)) {
    if (field.required) return { error: "fieldRequired" };
    return { value: fieldIsMultiple(field.type) ? [] : field.type === "checkbox" ? false : "" };
  }

  switch (field.type) {
    case "checkbox":
      return { value: true };

    case "multi": {
      const allowed = new Set(field.options);
      const picked = (Array.isArray(value) ? value : [value])
        .map((v) => cleanText(v, MAX_LABEL))
        .filter((v) => allowed.has(v));
      if (!picked.length && field.required) return { error: "fieldRequired" };
      return { value: picked };
    }

    case "select": {
      const picked = cleanText(value, MAX_LABEL);
      // An option removed from the event after a guest replied would otherwise
      // silently blank their answer on the next save.
      if (!field.options.includes(picked)) return { error: "fieldBadChoice" };
      return { value: picked };
    }

    case "number": {
      const n = Number(String(value).replace(/[^\d.-]/g, ""));
      if (!Number.isFinite(n)) return { error: "fieldBadNumber" };
      return { value: String(n) };
    }

    case "date": {
      const text = cleanText(value, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) {
        return { error: "fieldBadDate" };
      }
      return { value: text };
    }

    case "phone": {
      const normalised = normalizePhone(value);
      if (!normalised) return { error: "fieldBadPhone" };
      return { value: normalised };
    }

    case "email": {
      const text = cleanText(value, 200).toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) return { error: "fieldBadEmail" };
      return { value: text };
    }

    case "file": {
      // The answer is a Drive file id put there by uploadFieldFile — never a
      // path or URL the guest chose.
      const text = cleanText(value, 128).replace(/[^A-Za-z0-9_-]/g, "");
      if (!text) return { error: "fieldRequired" };
      return { value: text };
    }

    default:
      return { value: cleanText(value, MAX_ANSWER) };
  }
}

/* Validate a whole reply's custom answers.

   `attending` decides which family fields are in scope, and `headCount` how
   many attendee blocks are expected — both come from the already-validated
   built-in reply, so a guest cannot dodge a required question by lying about
   the shape of the form.

   Returns {ok, custom, attendees} or {error, fieldId, index}. */
export function validateAnswers(fields, { attending, headCount = 0, custom = {}, attendees = [] } = {}) {
  const defs = sanitizeFields(fields);
  const cleanCustom = {};

  for (const field of defs) {
    if (field.scope !== "family") continue;
    if (field.when !== "any" && attending !== "yes") continue;
    const result = coerceAnswer(field, custom?.[field.id]);
    if (result.error) return { error: result.error, fieldId: field.id };
    if (!isBlank(field, result.value)) cleanCustom[field.id] = result.value;
  }

  const perPerson = defs.filter((f) => f.scope === "attendee");
  const cleanAttendees = [];

  if (attending === "yes" && perPerson.length) {
    const blocks = Math.min(Math.max(0, headCount), MAX_ATTENDEE_BLOCKS);
    for (let i = 0; i < blocks; i += 1) {
      const source = attendees?.[i] || {};
      const entry = {};
      for (const field of perPerson) {
        const result = coerceAnswer(field, source[field.id]);
        if (result.error) return { error: result.error, fieldId: field.id, index: i };
        if (!isBlank(field, result.value)) entry[field.id] = result.value;
      }
      cleanAttendees.push(entry);
    }
  }

  return { ok: true, custom: cleanCustom, attendees: cleanAttendees };
}

/* ---- reading answers back ----------------------------------------------- */

export function parseAnswers(json, fallback) {
  if (!json) return fallback;
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(fallback)) return Array.isArray(parsed) ? parsed : fallback;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/* One answer as a human-readable string — for the Replies table and the CSV.
   Never returns null so a column never collapses. */
export function answerText(field, value) {
  if (value === undefined || value === null || value === "") return "";
  if (field.type === "checkbox") return value ? "Yes" : "";
  if (fieldIsMultiple(field.type)) return Array.isArray(value) ? value.join("; ") : "";
  if (field.type === "file") return value ? `https://drive.google.com/file/d/${value}/view` : "";
  return String(value);
}
