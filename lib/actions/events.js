"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { getDb } from "@/lib/db";
import {
  listEvents,
  getEvent,
  recipientCounts,
  createEvent,
  updateEvent,
  deleteEvent as deleteEventRow,
  listContactLists,
  getContacts,
  createContactList,
  deleteContactList as deleteContactListRow,
  listRecipients,
  setRecipientsFromList,
  recordRsvp,
} from "@/lib/events/store";
import {
  saveEventAsset,
  deleteEventAsset,
  ASSET_EXT_BY_TYPE,
  kindLimits,
} from "@/lib/events/assets";
import { normalizeDesign, LANGUAGES } from "@/lib/events/design";
import { parseCsv, guessMapping, looksLikeHeader, rowsToContacts } from "@/lib/events/csv";
import {
  inviteUrl,
  emailSubject,
  publicOrigin,
  whatsappParameters,
  SEND_DELAY_MS,
} from "@/lib/events/send";
import { startSendJob, jobState, isRunning } from "@/lib/events/job";
import { renderInviteEmail, renderInviteText } from "@/lib/events/email-html";
import { sendMail, mailerConfigured, verifyMailer } from "@/lib/events/mailer";
import { watiConfigured, watiTemplateName, watiTemplateLanguages, sendTemplateMessage } from "@/lib/events/wati";

// Every action in this file sends mail to parents or reads their contact
// details, so all of them gate on admin — not merely on "logged in".
async function requireAdmin() {
  return requireRole(["admin"]);
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function eventsOverview() {
  await requireAdmin();
  return {
    events: listEvents(),
    lists: listContactLists(),
    channels: channelStatus(),
  };
}

function channelStatus() {
  return {
    email: mailerConfigured(),
    whatsapp: watiConfigured(),
    whatsappTemplate: watiTemplateName(),
    whatsappTemplateLanguages: watiTemplateLanguages(),
    origin: publicOrigin(),
    sendDelayMs: SEND_DELAY_MS,
  };
}

export async function eventDetail(eventId) {
  await requireAdmin();
  const event = getEvent(eventId);
  if (!event) return null;
  return {
    event,
    recipients: listRecipients(eventId),
    counts: recipientCounts(eventId),
    job: jobState(eventId),
    lists: listContactLists(),
    channels: channelStatus(),
  };
}

// ── Event CRUD ─────────────────────────────────────────────────────────────

export async function newEvent(title) {
  const session = await requireAdmin();
  const event = createEvent({ title, createdBy: session.userId });
  revalidatePath("/events");
  return event;
}

export async function saveEvent(eventId, patch) {
  await requireAdmin();
  const existing = getEvent(eventId);
  if (!existing) return { error: "That event no longer exists." };

  const clean = { ...patch };
  if (clean.design) clean.design = normalizeDesign(clean.design);
  // An unknown language would hit the CHECK constraint as a raw SQL error, and
  // would have no wording to render with. Drop it instead.
  if (clean.language !== undefined && !LANGUAGES.some((l) => l.id === clean.language)) {
    delete clean.language;
  }
  if (clean.agenda) {
    clean.agenda = clean.agenda
      .map((a) => ({ time: String(a?.time || "").slice(0, 40), activity: String(a?.activity || "").slice(0, 160) }))
      .filter((a) => a.time || a.activity);
  }

  const event = updateEvent(eventId, clean);
  revalidatePath("/events");
  revalidatePath(`/invite/${event.slug}`);
  return { event };
}

export async function deleteEvent(eventId) {
  await requireAdmin();
  const event = getEvent(eventId);
  if (event) {
    if (event.logoPath) deleteEventAsset(event.logoPath);
    if (event.backgroundPath) deleteEventAsset(event.backgroundPath);
    deleteEventRow(eventId);
  }
  revalidatePath("/events");
  return { ok: true };
}

// ── Assets ─────────────────────────────────────────────────────────────────

export async function uploadEventAsset(formData) {
  await requireAdmin();

  const eventId = String(formData.get("eventId") || "");
  const kind = formData.get("kind") === "background" ? "background" : "logo";
  const file = formData.get("file");

  const event = getEvent(eventId);
  if (!event) return { error: "That event no longer exists." };
  if (!file || typeof file === "string") return { error: "No image received." };

  const { maxBytes, allowSvg } = kindLimits(kind);
  const ext = ASSET_EXT_BY_TYPE[file.type];
  if (!ext || (ext === "svg" && !allowSvg)) {
    return { error: `Unsupported format — upload a JPG, PNG or WebP${allowSvg ? " (or SVG)" : ""}.` };
  }
  if (file.size > maxBytes) {
    return { error: `That image is too large (max ${Math.round(maxBytes / 1024 / 1024)} MB).` };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const name = saveEventAsset(bytes, ext);

  // Replace, don't accumulate — the old file is dead the moment this succeeds.
  const previous = kind === "background" ? event.backgroundPath : event.logoPath;
  const updated = updateEvent(eventId, kind === "background" ? { backgroundPath: name } : { logoPath: name });
  if (previous && previous !== name) deleteEventAsset(previous);

  revalidatePath("/events");
  revalidatePath(`/invite/${event.slug}`);
  return { event: updated };
}

export async function clearEventAsset(eventId, kind) {
  await requireAdmin();
  const event = getEvent(eventId);
  if (!event) return { error: "That event no longer exists." };

  const previous = kind === "background" ? event.backgroundPath : event.logoPath;
  const updated = updateEvent(eventId, kind === "background" ? { backgroundPath: "" } : { logoPath: "" });
  if (previous) deleteEventAsset(previous);

  revalidatePath("/events");
  return { event: updated };
}

// ── Contacts ───────────────────────────────────────────────────────────────

// Step 1 of import: read the file and show the operator what we found, so a
// mis-detected column is caught before anything is stored.
export async function previewCsv(formData) {
  await requireAdmin();
  const file = formData.get("file");
  if (!file || typeof file === "string") return { error: "No CSV received." };
  if (file.size > 2 * 1024 * 1024) return { error: "That CSV is too large (max 2 MB)." };

  const text = new TextDecoder("utf-8").decode(await file.arrayBuffer());
  const rows = parseCsv(text);
  if (!rows.length) return { error: "That file has no rows in it." };

  const hasHeader = looksLikeHeader(rows[0]);
  const mapping = hasHeader ? guessMapping(rows[0]) : { name: 0, email: 1, phone: 2, child_name: -1 };
  const { contacts, skipped } = rowsToContacts(rows, mapping, { hasHeader });

  return {
    fileName: file.name || "contacts.csv",
    headers: rows[0].map((h) => String(h)),
    hasHeader,
    mapping,
    sampleRows: rows.slice(hasHeader ? 1 : 0, hasHeader ? 6 : 5).map((r) => r.map(String)),
    rows,
    contactCount: contacts.length,
    skipped: skipped.slice(0, 10),
    skippedCount: skipped.length,
  };
}

// Step 2: store it, with whatever mapping the operator confirmed.
export async function saveContactList({ name, sourceName, rows, mapping, hasHeader }) {
  const session = await requireAdmin();
  if (!Array.isArray(rows) || !rows.length) return { error: "Nothing to import." };

  const { contacts, skipped } = rowsToContacts(rows, mapping, { hasHeader });
  if (!contacts.length) {
    return { error: "None of those rows had a usable email address or phone number — check the column mapping." };
  }

  const { id, count } = createContactList({
    name: name || sourceName || "Parent list",
    sourceName,
    contacts,
    createdBy: session.userId,
  });

  revalidatePath("/events");
  return { listId: id, count, skippedCount: skipped.length };
}

export async function deleteContactList(listId) {
  await requireAdmin();
  deleteContactListRow(listId);
  revalidatePath("/events");
  return { ok: true };
}

// Snapshot a list onto the event. Refuses once the invite has gone out, so a
// sent event's delivery record can never be rewritten under it.
export async function attachList(eventId, listId) {
  await requireAdmin();
  const event = getEvent(eventId);
  if (!event) return { error: "That event no longer exists." };
  if (event.status === "sent") {
    return { error: "This invite has already been sent — create a new event to invite a different list." };
  }

  const contacts = getContacts(listId);
  if (!contacts.length) return { error: "That list is empty." };

  const recipients = setRecipientsFromList(eventId, contacts);
  revalidatePath("/events");
  return { recipients };
}

// ── Sending ────────────────────────────────────────────────────────────────

export async function checkChannels() {
  await requireAdmin();
  const mail = await verifyMailer();
  return {
    email: { configured: mailerConfigured(), ...mail },
    whatsapp: { configured: watiConfigured(), template: watiTemplateName() },
    origin: publicOrigin(),
  };
}

/**
 * Send the invite to the operator only, exactly as a parent would receive it.
 * Uses a throwaway recipient that is never written to the database, so a test
 * can't pollute the RSVP list or consume a real parent's token.
 */
export async function sendTestInvite(eventId, { email, phone }) {
  const session = await requireAdmin();
  const event = getEvent(eventId);
  if (!event) return { error: "That event no longer exists." };

  const probe = {
    id: "test",
    name: session.fullName || "there",
    email: String(email || "").trim(),
    phone: String(phone || "").replace(/\D/g, ""),
    token: "",
    childName: "",
  };
  if (!probe.email && !probe.phone) return { error: "Give me an email address or a WhatsApp number to test with." };

  const result = { email: null, whatsapp: null };

  if (probe.email) {
    if (!mailerConfigured()) {
      result.email = { ok: false, error: "SMTP is not configured yet." };
    } else {
      try {
        const url = inviteUrl(event, probe);
        await sendMail({
          to: probe.email,
          subject: `[TEST] ${emailSubject(event)}`,
          html: renderInviteEmail(event, { inviteUrl: url, assetBase: publicOrigin(), recipientName: probe.name }),
          text: renderInviteText(event, { inviteUrl: url, recipientName: probe.name }),
        });
        result.email = { ok: true };
      } catch (err) {
        result.email = { ok: false, error: err?.message || String(err) };
      }
    }
  }

  if (probe.phone) {
    if (!watiConfigured()) {
      result.whatsapp = { ok: false, error: "WATI is not configured yet." };
    } else {
      try {
        await sendTemplateMessage(probe.phone, whatsappParameters(event, probe), `LQK test — ${event.title}`.slice(0, 60));
        result.whatsapp = { ok: true };
      } catch (err) {
        result.whatsapp = { ok: false, error: err?.message || String(err) };
      }
    }
  }

  return { result };
}

/**
 * Start delivering the invite in the background and return at once.
 *
 * The browser used to drive this loop batch by batch. That works for thirty
 * parents and quietly fails for a thousand: a 1,000-parent send runs about
 * fifteen minutes at the throttle Google and WATI tolerate, and the operator
 * would have to keep the tab open and the laptop awake for all of it. Now the
 * server owns the loop and the page only polls `sendProgress`.
 */
export async function startSend(eventId, channels = { email: true, whatsapp: true }) {
  await requireAdmin();
  const event = getEvent(eventId);
  if (!event) return { error: "That event no longer exists." };

  const counts = recipientCounts(eventId);
  if (!counts.total) return { error: "No parents attached yet — import or pick a contact list first." };
  if (!channels.email && !channels.whatsapp) return { error: "Pick at least one way to send." };

  if (isRunning(eventId)) return { job: jobState(eventId), counts, alreadyRunning: true };

  const job = startSendJob(eventId, channels);
  return { job, counts };
}

/**
 * Cheap poll for a send in flight: aggregate counts and job state only.
 *
 * Returning the recipient rows here would mean shipping a thousand of them
 * every couple of seconds to move a progress bar. The full table is fetched
 * separately, when the send ends or the admin asks.
 */
export async function sendProgress(eventId) {
  await requireAdmin();
  return { job: jobState(eventId), counts: recipientCounts(eventId), status: getEvent(eventId)?.status || "draft" };
}

// The full recipient table. Separate from the poll so the expensive read
// happens when it is actually wanted.
export async function refreshRecipients(eventId) {
  await requireAdmin();
  return { recipients: listRecipients(eventId), counts: recipientCounts(eventId) };
}

// Retry just the parents whose delivery failed on one channel, without
// touching anyone else. Resets those rows to pending and lets the same
// background job pick them up — one send loop in the codebase, not two.
export async function retryFailed(eventId, channel) {
  await requireAdmin();
  const event = getEvent(eventId);
  if (!event) return { error: "That event no longer exists." };
  if (isRunning(eventId)) return { error: "A send is already running — wait for it to finish." };

  const isWhatsapp = channel === "whatsapp";
  const result = getDb()
    .prepare(
      isWhatsapp
        ? "UPDATE event_recipients SET whatsapp_status = 'pending', whatsapp_error = NULL WHERE event_id = ? AND whatsapp_status = 'failed'"
        : "UPDATE event_recipients SET email_status = 'pending', email_error = NULL WHERE event_id = ? AND email_status = 'failed'"
    )
    .run(eventId);

  const retried = Number(result.changes) || 0;
  if (!retried) return { counts: recipientCounts(eventId), retried: 0 };

  const job = startSendJob(eventId, { email: !isWhatsapp, whatsapp: isWhatsapp });
  revalidatePath("/events");
  return { job, counts: recipientCounts(eventId), retried };
}

// ── RSVP (called from the public invite page) ──────────────────────────────

// Deliberately NOT admin-gated: this is the parent answering. The unguessable
// per-recipient token is the whole authorisation story, which is why it comes
// from randomBytes and why an unknown token simply does nothing.
export async function submitRsvp(token, answer) {
  const clean = answer === "yes" || answer === "no" ? answer : null;
  if (!clean || !token) return { error: "Something went wrong — please try again." };

  const recipient = recordRsvp(String(token), clean);
  if (!recipient) return { error: "We couldn't find that invitation." };

  revalidatePath("/events");
  return { rsvp: recipient.rsvp };
}
