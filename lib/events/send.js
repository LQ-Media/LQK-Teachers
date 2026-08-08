import "server-only";
import { markDelivery } from "./store.js";
import { renderInviteEmail, renderInviteText } from "./email-html.js";
import { sendMail, mailerConfigured } from "./mailer.js";
import { sendTemplateMessage, watiConfigured } from "./wati.js";
import { t } from "./design.js";
import { formatWhenShort } from "./format.js";

// Absolute origin for links and images. Emails and WhatsApp messages leave the
// server, so a relative URL is useless in both — everything must be absolute.
export function publicOrigin() {
  const configured = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return String(configured).replace(/\/+$/, "");
  // Railway injects its own hostname; fall back to it, then to the live domain.
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (railway) return `https://${railway}`;
  return "https://teachers.littlequrankids.sg";
}

export function inviteUrl(event, recipient) {
  const origin = publicOrigin();
  // The token identifies the parent so the RSVP lands on the right row without
  // asking them to type anything.
  return recipient?.token
    ? `${origin}/invite/${event.slug}?r=${recipient.token}`
    : `${origin}/invite/${event.slug}`;
}

export function emailSubject(event) {
  const s = t(event.language);
  return `${s.youreInvited}: ${event.title}`;
}

/**
 * WhatsApp template parameters, in the order the approved template expects.
 * Changing this order silently reshuffles every parent's message, so it is
 * documented alongside the template wording in docs/EVENTS.md.
 *
 *   {{1}} parent name   {{2}} event title   {{3}} date & time
 *   {{4}} venue         {{5}} invite link
 */
export function whatsappParameters(event, recipient) {
  return [
    { name: "1", value: recipient.name || t(event.language).parentFallback },
    { name: "2", value: event.title },
    { name: "3", value: formatWhenShort(event.startsAt, event.language) || "—" },
    { name: "4", value: event.venueName || event.venueAddress || "—" },
    { name: "5", value: inviteUrl(event, recipient) },
  ];
}

async function sendEmailTo(event, recipient) {
  const url = inviteUrl(event, recipient);
  await sendMail({
    to: recipient.email,
    subject: emailSubject(event),
    html: renderInviteEmail(event, {
      inviteUrl: url,
      assetBase: publicOrigin(),
      recipientName: recipient.name,
    }),
    text: renderInviteText(event, { inviteUrl: url, recipientName: recipient.name }),
  });
}

async function sendWhatsAppTo(event, recipient) {
  await sendTemplateMessage(
    recipient.phone,
    whatsappParameters(event, recipient),
    `LQK ${event.title}`.slice(0, 60),
    event.language
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Deliver one event to one parent across both channels.
 *
 * A failure on one channel never aborts the other or the rest of the list: one
 * parent with a dead mailbox must not stop the other two hundred invites. Each
 * outcome is written to the recipient row, which is what the portal's live list
 * reads.
 */
export async function deliverToRecipient(event, recipient, { channels = { email: true, whatsapp: true } } = {}) {
  const result = { email: null, whatsapp: null };

  if (channels.email && recipient.email && recipient.emailStatus !== "sent") {
    if (!mailerConfigured()) {
      markDelivery(recipient.id, "email", "failed", "SMTP not configured");
      result.email = "failed";
    } else {
      try {
        await sendEmailTo(event, recipient);
        markDelivery(recipient.id, "email", "sent", null);
        result.email = "sent";
      } catch (err) {
        markDelivery(recipient.id, "email", "failed", err?.message || String(err));
        result.email = "failed";
      }
    }
  }

  if (channels.whatsapp && recipient.phone && recipient.whatsappStatus !== "sent") {
    if (!watiConfigured()) {
      markDelivery(recipient.id, "whatsapp", "failed", "WATI not configured");
      result.whatsapp = "failed";
    } else {
      try {
        await sendWhatsAppTo(event, recipient);
        markDelivery(recipient.id, "whatsapp", "sent", null);
        result.whatsapp = "sent";
      } catch (err) {
        markDelivery(recipient.id, "whatsapp", "failed", err?.message || String(err));
        result.whatsapp = "failed";
      }
    }
  }

  return result;
}

// Pause between parents. Google throttles bursts and WATI rate-limits, so this
// is a deliberate brake, not an accident.
export const SEND_DELAY_MS = Number(process.env.EVENT_SEND_DELAY_MS || 900);

// How many parents one client-driven batch covers. Small enough that a batch
// finishes well inside any request timeout at SEND_DELAY_MS per parent.
export const SEND_BATCH_SIZE = 8;

export async function deliverBatch(event, recipients, options) {
  const results = [];
  for (const recipient of recipients) {
    results.push({ id: recipient.id, ...(await deliverToRecipient(event, recipient, options)) });
    if (SEND_DELAY_MS > 0) await sleep(SEND_DELAY_MS);
  }
  return results;
}
