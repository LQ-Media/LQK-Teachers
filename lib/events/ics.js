/* iCalendar (.ics) for an invitation — the audience is iPhone-heavy, and a
   downloaded .ics opens straight into Apple Calendar where the Google URL
   forces a browser sign-in first.

   Times are emitted as Asia/Singapore WALL TIME with a VTIMEZONE block
   (Singapore has had no DST since 1982, so one STANDARD rule is the whole
   truth). The wall time is extracted through the same Intl path the page uses
   to DISPLAY the date, so whatever quirks live in how starts_at was stored,
   the calendar entry always matches what the invitation showed the guest.

   Pure module — no db, no server-only — so it is unit-testable. */

function wallTime(iso) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type) => parts.find((p) => p.type === type)?.value || "00";
  // Intl can emit hour "24" at midnight; normalise it.
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}${get("month")}${get("day")}T${hour}${get("minute")}${get("second")}`;
}

/* RFC 5545: backslash-escape, and fold nothing — lines here stay short. */
function esc(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export function buildInviteIcs({ event, uid }) {
  if (!event?.starts_at) return null;

  const start = wallTime(event.starts_at);
  const end = event.ends_at
    ? wallTime(event.ends_at)
    : wallTime(new Date(new Date(event.starts_at).getTime() + 3 * 3600 * 1000).toISOString());
  const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
  const location = [event.venue_name, event.venue_address].filter(Boolean).join(", ");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Little Quran Kids//Event Invitations//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Singapore",
    "BEGIN:STANDARD",
    "DTSTART:19820101T000000",
    "TZOFFSETFROM:+0800",
    "TZOFFSETTO:+0800",
    "TZNAME:+08",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${esc(uid)}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Asia/Singapore:${start}`,
    `DTEND;TZID=Asia/Singapore:${end}`,
    `SUMMARY:${esc(event.title)}`,
    location ? `LOCATION:${esc(location)}` : null,
    event.host_name ? `DESCRIPTION:${esc(`Hosted by ${event.host_name}`)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}
