// The expected-guest list parser (lib/qr/csv.js).
//
// This is the only place in the feature that eats a file somebody else made.
// It arrives as an Excel export, a Google Sheets paste, or a block of names
// out of WhatsApp, and every one of those has its own way of being awkward.
// A parser that quietly loses a family means that family stands at the door
// being told they aren't on the list.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseInviteeCsv, searchName } from "../lib/qr/csv.js";

const names = (text) => parseInviteeCsv(text).rows.map((r) => r.name);

describe("parseInviteeCsv", () => {
  test("a bare list of names, one per line, needs no header at all", () => {
    // The most likely paste of all, and the one a header-assuming parser
    // silently decapitates.
    assert.deepEqual(names("Fatimah Rahman\nAhmad Ismail\nSiti Aminah"), [
      "Fatimah Rahman",
      "Ahmad Ismail",
      "Siti Aminah",
    ]);
  });

  test("a header row is used when it actually names a column", () => {
    const result = parseInviteeCsv("name,phone,note\nFatimah Rahman,91234567,Iqra 2");
    assert.equal(result.usedHeader, true);
    assert.deepEqual(result.rows, [
      { name: "Fatimah Rahman", phone: "91234567", note: "Iqra 2" },
    ]);
  });

  test("a first row that is a guest is NOT eaten as a header", () => {
    const result = parseInviteeCsv("Fatimah Rahman\nAhmad Ismail");
    assert.equal(result.usedHeader, false);
    assert.equal(result.rows.length, 2, "nobody was dropped");
  });

  test("column order is read from the header, not assumed", () => {
    const result = parseInviteeCsv("Class,Full Name,Mobile\nTahfiz,Ahmad Ismail,98765432");
    assert.deepEqual(result.rows, [
      { name: "Ahmad Ismail", phone: "98765432", note: "Tahfiz" },
    ]);
  });

  test("a quoted comma stays inside one name", () => {
    // "Rahman, Fatimah" is one guest. A split(",") turns her into two.
    assert.deepEqual(names('"Rahman, Fatimah"\n"Ismail, Ahmad"'), [
      "Rahman, Fatimah",
      "Ismail, Ahmad",
    ]);
  });

  test("escaped quotes survive", () => {
    assert.deepEqual(names('"Ahmad ""Mat"" Ismail"'), ['Ahmad "Mat" Ismail']);
  });

  test("Windows line endings and Excel's BOM do not corrupt the first row", () => {
    // The BOM left in place becomes part of the first header cell, and "name"
    // silently stops matching — so the header is imported as a guest.
    const result = parseInviteeCsv("﻿name,phone\r\nFatimah Rahman,91234567\r\n");
    assert.equal(result.usedHeader, true);
    assert.deepEqual(names("﻿name,phone\r\nFatimah Rahman,91234567\r\n"), ["Fatimah Rahman"]);
  });

  test("a tab-separated paste out of Sheets is read too", () => {
    assert.deepEqual(names("name\tnote\nFatimah Rahman\tIqra 2"), ["Fatimah Rahman"]);
  });

  test("blank lines and trailing newlines are skipped, not imported as blanks", () => {
    const result = parseInviteeCsv("Fatimah Rahman\n\n\nAhmad Ismail\n");
    assert.deepEqual(result.rows.map((r) => r.name), ["Fatimah Rahman", "Ahmad Ismail"]);
  });

  test("the same name twice is one entry, and the repeat is reported", () => {
    // A duplicate is a spreadsheet artefact. Left in, the second copy can never
    // be claimed and sits in "still to arrive" all day.
    const result = parseInviteeCsv("Fatimah Rahman\nfatimah rahman\nAhmad Ismail");
    assert.deepEqual(result.rows.map((r) => r.name), ["Fatimah Rahman", "Ahmad Ismail"]);
    assert.equal(result.skipped, 1);
  });

  test("runs of whitespace inside a name are collapsed", () => {
    assert.deepEqual(names("  Fatimah    Rahman  "), ["Fatimah Rahman"]);
  });

  test("without a header, a second column is only taken as a phone if it looks like one", () => {
    // Otherwise a "Class" column lands in the phone field and the studio shows
    // "Iqra 2" as a contact number.
    const phone = parseInviteeCsv("Fatimah Rahman,9123 4567").rows[0];
    assert.equal(phone.phone, "9123 4567");
    const note = parseInviteeCsv("Fatimah Rahman,Iqra 2").rows[0];
    assert.equal(note.phone, null);
    assert.equal(note.note, "Iqra 2");
  });

  test("empty input yields nothing rather than throwing on a live page", () => {
    assert.deepEqual(parseInviteeCsv("").rows, []);
    assert.deepEqual(parseInviteeCsv(null).rows, []);
    assert.deepEqual(parseInviteeCsv("   \n  \n").rows, []);
  });
});

describe("searchName", () => {
  test("matching is case- and spacing-insensitive", () => {
    assert.equal(searchName("  Fatimah   RAHMAN "), "fatimah rahman");
  });
});
