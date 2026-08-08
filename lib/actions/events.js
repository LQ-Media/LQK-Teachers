"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { getDb } from "@/lib/db";
import {
  listEvents,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent as deleteEventRow,
  markEventSent,
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
import { normalizeDesign } from "@/lib/events/design";
import { parseCsv, guessMapping, looksLikeHeader, rowsToContacts } from "@/lib/events/csv";
import {
  deliverBatch,
  inviteUrl,
  emailSubject,
  publicOrigin,
  whatsappParameters,
  SEND_BATCH_SIZE,
} from "@/lib/events/send";
import { renderInviteEmail, renderInviteText } from "@/lib/events/email-html";
import { sendMail, mailerConfigured, verifyMailer } from "@/lib/events/mailer";
import { watiConfigured, watiTemplateName, sendTemplateMessage } from "@/lib/events/wati";

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
    origin: publicOrigin(),
  };
}

export async function eventDetail(eventId) {
  await requireAdmin();
  const event = getEvent(eventId);
  if (!event) return null;
  return {
    event,
    recipients: listRecipients(eventId),
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
 * Send one batch of pending invites and report progress.
 *
 * The client drives the loop: a 200-parent list at roughly a second per parent
 * outlives any sane request timeout, and batching means a dropped connection
 * costs one batch rather than the whole send. Because each recipient's row
 * records its own outcome, re-running only picks up whoever is still pending —
 * a retry never double-sends to a parent already marked sent.
 */
export async function sendEventBatch(eventId, channels = { email: true, whatsapp: true }) {
  await requireAdmin();
  const event = getEvent(eventId);
  if (!event) return { error: "That event no longer exists." };

  const all = listRecipients(eventId);
  if (!all.length) return { error: "No parents attached yet — import or pick a contact list first." };

  const pending = all.filter(
    (r) =>
      (channels.email && r.emailStatus === "pending") ||
      (channels.whatsapp && r.whatsappStatus === "pending")
  );

  const batch = pending.slice(0, SEND_BATCH_SIZE);
  if (batch.length) await deliverBatch(event, batch, { channels });

  const after = listRecipients(eventId);
  const stillPending = after.filter(
    (r) =>
      (channels.email && r.emailStatus === "pending") ||
      (channels.whatsapp && r.whatsappStatus === "pending")
  ).length;

  if (!stillPending && event.status !== "sent") markEventSent(eventId);

  revalidatePath("/events");
  return {
    recipients: after,
    done: stillPending === 0,
    remaining: stillPending,
    total: after.length,
  };
}

// Retry just the parents whose delivery failed, without touching the rest.
export async function retryFailed(eventId, channel) {
  await requireAdmin();
  const event = getEvent(eventId);
  if (!event) return { error: "That event no longer exists." };

  const column = channel === "whatsapp" ? "whatsappStatus" : "emailStatus";
  const failed = listRecipients(eventId).filter((r) => r[column] === "failed");
  if (!failed.length) return { recipients: listRecipients(eventId), retried: 0 };

  const batch = failed.slice(0, SEND_BATCH_SIZE);
  for (const recipient of batch) {
    // deliverToRecipient skips anything already marked sent, so reset first.
    getDb()
      .prepare(
        channel === "whatsapp"
          ? "UPDATE event_recipients SET whatsapp_status = 'pending', whatsapp_error = NULL WHERE id = ?"
          : "UPDATE event_recipients SET email_status = 'pending', email_error = NULL WHERE id = ?"
      )
      .run(recipient.id);
  }

  const refreshed = listRecipients(eventId).filter((r) => batch.some((b) => b.id === r.id));
  await deliverBatch(event, refreshed, {
    channels: { email: channel !== "whatsapp", whatsapp: channel === "whatsapp" },
  });

  revalidatePath("/events");
  return { recipients: listRecipients(eventId), retried: batch.length, remaining: failed.length - batch.length };
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
