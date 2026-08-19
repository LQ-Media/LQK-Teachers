/* Parsing the expected-guest CSV.

   The list arrives as an export from a spreadsheet, or as something Karim
   pasted out of WhatsApp, so this has to survive quoted fields, commas inside
   names ("Rahman, Fatimah"), CRLF from Windows Excel, a BOM from Excel's UTF-8
   export, a header row that may or may not be there, and a "list" that is just
   one name per line with no commas at all.

   Pure and dependency-free so it can be unit-tested and so the studio can
   preview a paste in the browser before anything is written. */

const MAX_ROWS = 2000;
const MAX_NAME = 80;

/* A minimal RFC-4180 reader. Written out rather than split(",") because the
   very first real list will contain "Nur Abdul Karim, Ustaz" in one cell and a
   naive split turns one guest into two. */
function readRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  // Strip the UTF-8 BOM Excel prepends; left in place it becomes part of the
  // first header cell and "name" stops matching.
  const input = String(text || "").replace(/^﻿/, "");

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"'; // an escaped quote
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === "," || char === "\t" || char === ";") {
      // Tab and semicolon too: a paste out of Sheets is tab-separated, and a
      // European Excel export uses semicolons.
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  row.push(field);
  rows.push(row);

  return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

const NAME_HEADERS = ["name", "full name", "guest", "guest name", "family", "parent"];
const PHONE_HEADERS = ["phone", "mobile", "hp", "contact", "number"];
const NOTE_HEADERS = ["note", "notes", "class", "group", "table", "remark", "remarks"];

function headerIndex(cells, candidates) {
  return cells.findIndex((cell) => candidates.includes(cell.trim().toLowerCase()));
}

/**
 * Parse a pasted guest list.
 *
 * @returns {{ rows: {name, phone, note}[], skipped: number, usedHeader: boolean }}
 *   `skipped` counts lines that had no usable name — surfaced in the studio so
 *   a list that half-imported says so, rather than quietly losing people.
 */
export function parseInviteeCsv(text) {
  const raw = readRows(text);
  if (!raw.length) return { rows: [], skipped: 0, usedHeader: false };

  // A header is only assumed when the first row actually names a column. A
  // list that starts with a real guest called "Name" is vanishingly rarer than
  // a list with no header at all, and dropping row one silently loses a guest.
  const first = raw[0];
  const nameAt = headerIndex(first, NAME_HEADERS);
  const usedHeader = nameAt !== -1;

  const columns = usedHeader
    ? { name: nameAt, phone: headerIndex(first, PHONE_HEADERS), note: headerIndex(first, NOTE_HEADERS) }
    : { name: 0, phone: 1, note: 2 };

  const body = usedHeader ? raw.slice(1) : raw;
  const rows = [];
  const seen = new Set();
  let skipped = 0;

  for (const cells of body) {
    if (rows.length >= MAX_ROWS) break;
    const name = String(cells[columns.name] || "").trim().replace(/\s+/g, " ").slice(0, MAX_NAME);
    if (!name) {
      skipped++;
      continue;
    }
    // Without a header there is no way to know column 2 is a phone, so only
    // take it when it looks like one — otherwise a "Class" column lands in the
    // phone field and the studio shows nonsense.
    const phoneCell = String(cells[columns.phone] ?? "").trim();
    const phone = usedHeader
      ? phoneCell
      : /^[+\d][\d\s()+-]{6,}$/.test(phoneCell)
        ? phoneCell
        : "";
    const noteCell = String(cells[columns.note] ?? "").trim();
    const note = usedHeader ? noteCell : phone ? noteCell : phoneCell;

    // The same name twice is a spreadsheet artefact, not two guests. Dedupe
    // case-insensitively: a duplicate on the door list is one entry that can
    // be claimed, and the second copy would sit there unclaimable all day.
    const key = name.toLowerCase();
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);

    rows.push({ name, phone: phone || null, note: note ? note.slice(0, 60) : null });
  }

  return { rows, skipped, usedHeader };
}

/** The lowercased form the door's type-ahead matches against. */
export function searchName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
