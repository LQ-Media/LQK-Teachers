// CSV import for parent contact lists.
//
// Deliberately hand-rolled rather than pulling a parser dependency: the app
// ships with almost none, and the input here is a small contact export, not
// arbitrary data. Handles the parts of RFC 4180 that real exports actually use
// — quoted fields, embedded commas, embedded newlines, doubled quotes — plus
// the two things spreadsheets add: a UTF-8 BOM and CRLF line endings.

const DEFAULT_COUNTRY_CODE = "65"; // Singapore

// Splits CSV text into rows of raw string cells.
export function parseCsv(text) {
  const src = String(text || "").replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'; // escaped quote
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // Trailing field/row (file not ending in a newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop rows that are entirely empty — trailing blank lines are ubiquitous.
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

// Header aliases we recognise without asking. Anything unmatched falls through
// to manual mapping in the UI, so an unusual export is never simply rejected.
const HEADER_ALIASES = {
  name: ["name", "parent", "parent name", "parent_name", "full name", "fullname", "guardian", "guardian name", "contact name"],
  email: ["email", "e-mail", "email address", "email_address", "parent email", "mail"],
  phone: ["phone", "mobile", "whatsapp", "contact", "phone number", "mobile number", "contact number", "hp", "handphone", "tel", "telephone"],
  child_name: ["child", "child name", "child_name", "student", "student name", "student_name", "kid", "son/daughter"],
};

function normalizeHeader(h) {
  return String(h || "").trim().toLowerCase().replace(/[_\s]+/g, " ");
}

// Best-effort guess of which column is which. Returns an index per field, or
// -1 when we could not tell.
export function guessMapping(headerRow) {
  const headers = (headerRow || []).map(normalizeHeader);
  const mapping = { name: -1, email: -1, phone: -1, child_name: -1 };

  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    let idx = headers.findIndex((h) => aliases.includes(h));
    // Fall back to a substring hit ("Parent Mobile No." → phone).
    if (idx === -1) idx = headers.findIndex((h) => h && aliases.some((a) => h.includes(a)));
    mapping[field] = idx;
  }
  return mapping;
}

// Does the first row look like headers rather than data? If any cell matches a
// known alias, treat it as a header row.
export function looksLikeHeader(row) {
  const headers = (row || []).map(normalizeHeader);
  const all = Object.values(HEADER_ALIASES).flat();
  return headers.some((h) => h && all.some((a) => h === a || h.includes(a)));
}

/**
 * Normalise a phone number to the digits-only international form WATI expects
 * (no '+', no spaces, no dashes).
 *
 * A bare 8-digit Singapore mobile gets the 65 country code; anything already
 * carrying a country code (leading '+' or a long enough string) is kept as-is.
 * Returns "" when the input cannot be a phone number, so the caller can mark
 * that contact WhatsApp-skipped rather than sending to a mangled number.
 */
export function normalizePhone(raw, countryCode = DEFAULT_COUNTRY_CODE) {
  const s = String(raw || "").trim();
  if (!s) return "";

  const hadPlus = s.startsWith("+") || s.startsWith("00");
  const digits = s.replace(/\D/g, "");
  if (!digits) return "";

  if (hadPlus) {
    // "00" is the other way of writing "+".
    return digits.replace(/^00/, "");
  }
  // Local Singapore mobile: 8 digits beginning 8 or 9.
  if (digits.length === 8 && /^[89]/.test(digits)) return countryCode + digits;
  // Already prefixed, or a foreign number typed without '+'.
  if (digits.length >= 10) return digits;
  // Too short to be dialable.
  return "";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value) {
  return EMAIL_RE.test(String(value || "").trim());
}

/**
 * Turn parsed CSV rows + a column mapping into contact records.
 *
 * Rows with neither a usable email nor a usable phone are returned in
 * `skipped` rather than dropped silently — an import that quietly loses eight
 * parents is worse than one that says so.
 */
export function rowsToContacts(rows, mapping, { hasHeader = true } = {}) {
  const body = hasHeader ? rows.slice(1) : rows;
  const pick = (row, idx) => (idx >= 0 && idx < row.length ? String(row[idx] || "").trim() : "");

  const contacts = [];
  const skipped = [];
  const seen = new Set();

  for (const row of body) {
    const rawEmail = pick(row, mapping.email);
    const email = isEmail(rawEmail) ? rawEmail.toLowerCase() : "";
    const phone = normalizePhone(pick(row, mapping.phone));
    const name = pick(row, mapping.name);
    const childName = pick(row, mapping.child_name);

    if (!email && !phone) {
      skipped.push({ row: row.join(", ").slice(0, 120), reason: rawEmail ? "Email isn't valid and no usable phone number" : "No email or phone number" });
      continue;
    }

    // De-duplicate within a single upload — exports often repeat a parent once
    // per child. Keyed on email+phone so genuine siblings still collapse to one
    // invite rather than three.
    const key = `${email}|${phone}`;
    if (seen.has(key)) continue;
    seen.add(key);

    contacts.push({ name, email, phone, childName });
  }

  return { contacts, skipped };
}
