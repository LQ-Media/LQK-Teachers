// The .ics builder (lib/events/ics.js). What matters: the wall time in the
// file equals the wall time the invitation DISPLAYS (both go through Intl in
// Asia/Singapore), and admin-entered text can't break the format.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildInviteIcs } from "../lib/events/ics.js";

const event = {
  title: "Maulid 2026; a night, of salawat",
  starts_at: "2026-09-12T11:00:00.000Z", // 19:00 in Singapore
  ends_at: "2026-09-12T14:00:00.000Z", // 22:00
  venue_name: "Woods Square",
  venue_address: "12 Woodlands Square",
  host_name: "Little Quran Kids",
  slug: "maulid-2026",
};

describe("buildInviteIcs", () => {
  const ics = buildInviteIcs({ event, uid: "abcd1234-maulid-2026@littlequrankids.sg" });

  test("emits Singapore wall time with the TZID", () => {
    assert.match(ics, /DTSTART;TZID=Asia\/Singapore:20260912T190000/);
    assert.match(ics, /DTEND;TZID=Asia\/Singapore:20260912T220000/);
    assert.match(ics, /BEGIN:VTIMEZONE/);
  });

  test("escapes commas and semicolons in admin-entered text", () => {
    assert.match(ics, /SUMMARY:Maulid 2026\\; a night\\, of salawat/);
    assert.match(ics, /LOCATION:Woods Square\\, 12 Woodlands Square/);
  });

  test("defaults a missing end to three hours after the start", () => {
    const open = buildInviteIcs({ event: { ...event, ends_at: null }, uid: "u" });
    assert.match(open, /DTEND;TZID=Asia\/Singapore:20260912T220000/);
  });

  test("no date, no file", () => {
    assert.equal(buildInviteIcs({ event: { ...event, starts_at: null }, uid: "u" }), null);
  });
});
