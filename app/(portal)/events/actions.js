"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import {
  createEvent,
  updateEvent,
  addGuests,
  getEvent,
  listGuests,
  guestsNeedingReminder,
  markSent,
  markReminded,
  normalizePhone,
} from "@/lib/events/queries";
import {
  sendMail,
  inviteEmailHtml,
  inviteEmailText,
  inviteEmailSubject,
  mailConfigured,
} from "@/lib/events/mail";
import { sendInviteWhatsApp, watiConfigured } from "@/lib/events/wati";
import { formatEventDate, formatDeadline } from "@/lib/events/i18n";

/* Admin actions. EVERY export re-checks the role — a server action is a public
   HTTP endpoint, and the fact that the only link to it sits behind an
   admin-gated page stops exactly nobody who reads the JS bundle. */

function baseUrl() {
  return (process.env.LQK_PUBLIC_BASE_URL || "https://teachers.littlequrankids.sg").replace(/\/+$/, "");
}

export async function createEventAction(form) {
  const session = await requireRole(["admin"]);
  const title = String(form.title || "").trim();
  if (!title) return { ok: false, error: "A title is required." };

  const event = createEvent({
    title,
    hostName: form.hostName,
    startsAt: form.startsAt || null,
    venueName: form.venueName,
    createdBy: session.userId,
  });
  revalidatePath("/events");
  return { ok: true, id: event.id };
}

export async function updateEventAction(id, patch) {
  await requireRole(["admin"]);
  updateEvent(id, patch);
  revalidatePath(`/events/${id}`);
  revalidatePath("/events");
  return { ok: true };
}

/* Paste-in importer. Accepts CSV or tab-separated, with or without a header
   row, in the order: name, email, phone, family name, language, party size.
   Deliberately forgiving — the real-world input is a column pasted out of
   WhatsApp or Sheets, not a clean RFC 4180 file. Rows are REPORTED back rather
   than silently dropped, so a mistyped phone is visible before the send. */
export async function importGuestsAction(eventId, text) {
  await requireRole(["admin"]);

  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const guests = [];
  const problems = [];

  for (const [i, line] of lines.entries()) {
    const cells = line.includes("\t") ? line.split("\t") : splitCsvLine(line);
    const [name, email, phone, familyName, lang, partySize] = cells.map((c) => (c || "").trim());

    // Skip an obvious header row.
    if (i === 0 && /^(name|guest)$/i.test(name)) continue;
    if (!name) continue;

    if (phone && !normalizePhone(phone)) {
      problems.push(`${name}: "${phone}" isn't a usable phone number — imported without it.`);
    }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      problems.push(`${name}: "${email}" doesn't look like an email — imported without it.`);
      guests.push({ name, phone, familyName, lang, partySize });
      continue;
    }

    guests.push({ name, email, phone, familyName, lang, partySize });
  }

  if (!guests.length) return { ok: false, error: "No guests found in that text." };

  const added = addGuests(eventId, guests);
  revalidatePath(`/events/${eventId}`);
  return { ok: true, added: added.length, problems };
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/* Send (or re-send) invitations.

   `mode` is "invite" for the first send and "remind" for the nudge cascade;
   the difference is only which guests are selected, so the two can never drift
   apart in wording or link format.

   Results are per-guest and returned in full. A batch that half-succeeds is the
   normal case on Resend's 100/day free tier, and Karim needs to see exactly who
   did NOT get it rather than a green tick over a partial send. */
export async function sendInvitesAction(eventId, { mode = "invite", channels = ["email"] } = {}) {
  await requireRole(["admin"]);

  const event = getEvent(eventId);
  if (!event) return { ok: false, error: "Event not found." };
  if (event.status === "draft") {
    return { ok: false, error: "Set the event live before sending — guests can't open a draft." };
  }

  const targets =
    mode === "remind"
      ? guestsNeedingReminder(eventId)
      : listGuests(eventId).filter((g) => !g.sent_email_at && !g.sent_wa_at);

  if (!targets.length) {
    return { ok: true, sent: 0, results: [], note: "Nobody is waiting for this send." };
  }

  const wantEmail = channels.includes("email");
  const wantWa = channels.includes("whatsapp");

  if (wantEmail && !mailConfigured()) return { ok: false, error: "RESEND_API_KEY is not set." };
  if (wantWa && !watiConfigured()) {
    return { ok: false, error: "Wati is not configured (WATI_API_URL / WATI_ACCESS_TOKEN)." };
  }

  const results = [];

  for (const guest of targets) {
    const url = `${baseUrl()}/i/${guest.token}${guest.lang !== "en" ? `?lang=${guest.lang}` : ""}`;
    const whenText = event.starts_at ? formatEventDate(event.starts_at, guest.lang) : "";
    const venueText = [event.venue_name, event.venue_address].filter(Boolean).join(", ");
    const deadlineText = event.rsvp_deadline ? formatDeadline(event.rsvp_deadline, guest.lang) : "";
    const row = { guest: guest.name, email: null, whatsapp: null };

    if (wantEmail && guest.email) {
      const res = await sendMail({
        to: guest.email,
        // Localised, and the event leads — never the guest's name.
        subject: inviteEmailSubject({ lang: guest.lang, eventTitle: event.title }),
        html: inviteEmailHtml({
          guestName: guest.name,
          eventTitle: event.title,
          whenText,
          venueText,
          url,
          accent: event.theme.palette.accent,
          lang: guest.lang,
          deadlineText,
          // The hidden inbox digest line: when · where — reply by.
          preheaderText: [whenText, event.venue_name].filter(Boolean).join(" · ") +
            (deadlineText ? ` — ${deadlineText}` : ""),
          crescentUrl: `${baseUrl()}/prop/crescent.png`,
          contactNumber: process.env.LQK_CONTACT_WHATSAPP || "",
        }),
        text: inviteEmailText({
          guestName: guest.name,
          eventTitle: event.title,
          whenText,
          venueText,
          url,
          lang: guest.lang,
          deadlineText,
        }),
        replyTo: process.env.MAIL_REPLY_TO || undefined,
      });
      row.email = res.ok ? "sent" : res.error;
      if (res.ok) markSent(guest.id, "email");
      // Resend rate-limits bursts; pace the loop rather than risk 429s.
      await new Promise((r) => setTimeout(r, 120));
    } else if (wantEmail) {
      row.email = "no email address";
    }

    if (wantWa && guest.phone) {
      const res = await sendInviteWhatsApp({
        phone: guest.phone,
        guestName: guest.name,
        eventTitle: event.title,
        url,
        deadlineText,
        lang: guest.lang,
      });
      row.whatsapp = res.ok ? "sent" : res.error;
      if (res.ok) markSent(guest.id, "wa");
      await new Promise((r) => setTimeout(r, 250));
    } else if (wantWa) {
      row.whatsapp = "no phone number";
    }

    if (mode === "remind") markReminded(guest.id);
    results.push(row);
  }

  revalidatePath(`/events/${eventId}`);
  const sent = results.filter((r) => r.email === "sent" || r.whatsapp === "sent").length;
  return { ok: true, sent, results };
}
