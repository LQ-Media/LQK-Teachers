/* One rule for reading an event's date out of the database.

   `starts_at` / `ends_at` are stored exactly as the editor's
   <input type="datetime-local"> produced them — "2026-08-30T18:00", Singapore
   wall time with NO timezone on the end. `new Date()` reads a naive string like
   that in the SERVER's zone, and the Railway container runs in UTC (the
   Dockerfile sets no TZ). So a 6:00 pm majlis was parsed as 18:00 UTC and
   printed back in Asia/Singapore as 2:00 am the NEXT DAY — on the events list,
   on the guest's invitation, in the WhatsApp and email "when" line, and in the
   calendar file.

   On a Singapore laptop the two errors cancel out exactly, which is why this
   looked correct everywhere it was written and only ever went wrong in
   production.

   Singapore has had no DST since 1982, so a fixed +08:00 is the whole truth —
   the same constant lib/hours/rates.js and isEventClosed already use.

   A value that DOES carry a zone (trailing Z or ±HH:MM) is left alone: it
   already names an instant, and re-stamping it would move the event.

   Pure module — no db, no server-only — so it is unit-testable and the client
   components can share it. */

/* "2026-08-30T18:00", "2026-08-30T18:00:00", "2026-08-30 18:00" — a date and a
   time with nothing after them to say WHERE. */
const NAIVE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/;

export function eventInstant(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const iso = NAIVE.test(text) ? `${text.replace(" ", "T")}+08:00` : text;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/* The moment replies stop: the END of the deadline day in Singapore, not
   midnight UTC. `rsvp_deadline` is a bare date, so it gets the same treatment. */
export function endOfDeadlineDay(dateOnly) {
  const day = String(dateOnly ?? "").trim().slice(0, 10);
  return day ? eventInstant(`${day}T23:59:59`) : null;
}
