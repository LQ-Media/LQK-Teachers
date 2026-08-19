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

const NAME_HEADERS = ["name", "full name", "student", "student name", "guest", "guest name", "child"];
/* Class is a first-class column, not a note: attendance is logged by name AND
   class, and Karim's lists come out of a system that already has one. */
const CLASS_HEADERS = ["class", "kelas", "group", "level", "cohort", "classroom"];
const PHONE_HEADERS = ["phone", "mobile", "hp", "contact", "number", "handphone"];
const NOTE_HEADERS = ["note", "notes", "table", "remark", "remarks", "comment"];

function headerIndex(cells, candidates) {
  return cells.findIndex((cell) => candidates.includes(cell.trim().toLowerCase()));
}

/**
 * Parse a pasted guest list.
 *
 * @returns {{ rows: {name, className, phone, note}[], skipped: number, usedHeader: boolean }}
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
    ? {
        name: nameAt,
        className: headerIndex(first, CLASS_HEADERS),
        phone: headerIndex(first, PHONE_HEADERS),
        note: headerIndex(first, NOTE_HEADERS),
      }
    // No header: "Name, Class" is overwhelmingly the shape of a hand-made list
    // for a school event, so column two is the class unless it looks like a
    // phone number.
    : { name: 0, className: 1, phone: -1, note: 2 };

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
    const cell = (index) => (index >= 0 ? String(cells[index] ?? "").trim() : "");
    const looksLikePhone = (text) => /^[+\d][\d\s()+-]{6,}$/.test(text);

    let className = cell(columns.className);
    let phone = cell(columns.phone);
    const note = cell(columns.note);

    // Without a header, column two was ASSUMED to be the class. If it is
    // plainly a phone number, treat it as one — otherwise "9123 4567" is
    // imported as a class name and every door match shows it as one.
    if (!usedHeader && looksLikePhone(className)) {
      phone = className;
      className = "";
    }

    /* The same name twice is a spreadsheet artefact, not two people: a
       duplicate is one entry that can be claimed, and the second copy would sit
       there unclaimable all day.

       Keyed on name AND CLASS, though — two children called Nur Aisyah in
       different classes are two different students, and collapsing them means
       one of them can never be marked present. */
    const key = `${name.toLowerCase()}|${className.toLowerCase()}`;
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);

    rows.push({
      name,
      className: className ? className.slice(0, 40) : null,
      phone: phone || null,
      note: note ? note.slice(0, 60) : null,
    });
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
