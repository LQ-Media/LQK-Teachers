import "server-only";
import { escapeAttr, escapeHtml } from "@/lib/mail";
import { bodyParagraphs } from "./fields";

/* Event invitation email: the copy and the HTML card.

   The Resend transport itself lives in lib/mail.js — it is shared with
   password-reset mail and is not event-specific. Re-exported here so the
   existing `@/lib/events/mail` call sites keep working unchanged. */
export { mailConfigured, sendMail, sendBatch } from "@/lib/mail";

/* Copy for the invite email, per language. One table so the HTML card, the
   plain-text part and the subject can never drift apart. The subject leads
   with the event, never the guest's name — "Ahmad, you're invited" reads like
   marketing spam in a full inbox. */
const EMAIL_COPY = {
  en: {
    subject: (title) => `An invitation for your family: ${title}`,
    salam: "Assalamu'alaikum",
    lead: "We would like to invite you and your family to",
    cta: "View your invitation & reply",
    deadline: (date) => `Please reply by ${date}.`,
    foot: "This invitation is personal to you — please don't share the link.",
    registerLead: "Passing this on to someone? This link is open to anyone:",
    registerCta: "Registration page",
    contact: (number) => `Questions? WhatsApp us on ${number}.`,
  },
  ms: {
    subject: (title) => `Jemputan untuk keluarga anda: ${title}`,
    salam: "Assalamu'alaikum",
    lead: "Kami ingin menjemput anda sekeluarga ke",
    cta: "Lihat jemputan & balas",
    deadline: (date) => `Sila balas sebelum ${date}.`,
    foot: "Jemputan ini khusus untuk anda — sila jangan kongsi pautannya.",
    registerLead: "Ingin berkongsi dengan orang lain? Pautan ini terbuka untuk sesiapa sahaja:",
    registerCta: "Halaman pendaftaran",
    contact: (number) => `Ada soalan? WhatsApp kami di ${number}.`,
  },
  ar: {
    subject: (title) => `دعوة لعائلتكم: ${title}`,
    salam: "السلام عليكم",
    lead: "يسعدنا دعوتكم وعائلتكم إلى",
    cta: "عرض الدعوة والرد",
    deadline: (date) => `نرجو الرد قبل ${date}.`,
    foot: "هذه الدعوة خاصة بكم — نرجو عدم مشاركة الرابط.",
    registerLead: "هل ترغبون في مشاركتها مع غيركم؟ هذا الرابط مفتوح للجميع:",
    registerCta: "صفحة التسجيل",
    contact: (number) => `للاستفسار، راسلونا على واتساب: ${number}.`,
  },
};

function copyFor(lang) {
  return EMAIL_COPY[lang] || EMAIL_COPY.en;
}

export function inviteEmailSubject({ lang, eventTitle }) {
  return copyFor(lang).subject(eventTitle);
}

/* The email is a CARD, not the invitation.

   Sending the full design as HTML email would mean Gmail clipping it at 102KB,
   Outlook's Word renderer destroying the layout, and no way to fix a typo after
   send. The card carries the essentials and a button; the invitation itself
   lives at the link, where it can be edited after the fact and rendered
   identically for every guest. Table-based and inline-styled because that is
   still what email clients understand.

   `preheaderText` is the hidden first line inbox list views show under the
   subject — the when/where/deadline digest. `crescentUrl` must be ABSOLUTE:
   email clients resolve nothing. */
export function inviteEmailHtml({
  guestName,
  eventTitle,
  whenText,
  venueText,
  url,
  accent = "#96681A",
  lang = "en",
  deadlineText = "",
  preheaderText = "",
  crescentUrl = "",
  contactNumber = "",
  registrationUrl = "",
  bodyText = "",
}) {
  const dir = lang === "ar" ? "rtl" : "ltr";
  const c = copyFor(lang);
  const foot = [c.foot, contactNumber ? c.contact(contactNumber) : null].filter(Boolean).join(" ");

  return `<!doctype html>
<html dir="${dir}" lang="${lang}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#FBF6EC;">
  ${preheaderText ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheaderText)}</div>` : ""}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF6EC;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:1px solid #E8DDC5;border-radius:20px;overflow:hidden;">
        <tr><td style="padding:28px 24px;text-align:center;font-family:Georgia,'Times New Roman',serif;color:#3B372B;" dir="${dir}">
          ${crescentUrl ? `<img src="${escapeAttr(crescentUrl)}" width="64" height="64" alt="" style="display:block;margin:0 auto 12px;border:0;">` : ""}
          <p style="margin:0 0 12px;font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#96681A;font-family:Arial,sans-serif;">${escapeHtml(c.salam)}${guestName ? `, ${escapeHtml(guestName)}` : ""}</p>
          <p style="margin:0 auto 8px;max-width:26ch;font-size:15px;line-height:1.45;color:#776E5D;">${escapeHtml(c.lead)}</p>
          <h1 style="margin:0 0 16px;font-size:26px;line-height:1.25;color:#3B372B;font-weight:normal;">${escapeHtml(eventTitle)}</h1>
          ${whenText ? `<p style="margin:14px 0 0;font-size:14px;color:#3B372B;font-family:Arial,sans-serif;">${escapeHtml(whenText)}</p>` : ""}
          ${venueText ? `<p style="margin:4px 0 0;font-size:14px;color:#776E5D;font-family:Arial,sans-serif;">${escapeHtml(venueText)}</p>` : ""}
          ${bodyParagraphs(bodyText)
            .map(
              (para) =>
                `<p style="margin:16px auto 0;max-width:42ch;font-size:14px;line-height:1.6;color:#3B372B;font-family:Arial,sans-serif;text-align:start;white-space:pre-line;">${escapeHtml(para)}</p>`
            )
            .join("")}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px auto 0;">
            <tr><td style="border-radius:999px;background:${accent};">
              <a href="${escapeAttr(url)}" style="display:inline-block;padding:14px 26px;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:999px;">${escapeHtml(c.cta)}</a>
            </td></tr>
          </table>
          ${deadlineText ? `<p style="margin:14px 0 0;font-size:12px;font-weight:600;color:#B0533A;font-family:Arial,sans-serif;">${escapeHtml(c.deadline(deadlineText))}</p>` : ""}
          ${/* The shareable link, set apart from the personal one directly
               above it — the footer tells them not to share THAT link, so this
               one has to say plainly that it is the other kind. */ ""}
          ${registrationUrl ? `<p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#776E5D;font-family:Arial,sans-serif;">${escapeHtml(c.registerLead)}<br><a href="${escapeAttr(registrationUrl)}" style="color:${accent};font-weight:bold;text-decoration:underline;">${escapeHtml(c.registerCta)}</a></p>` : ""}
          <p style="margin:24px 0 0;font-size:11px;line-height:1.6;color:#776E5D;font-family:Arial,sans-serif;">${escapeHtml(foot)}</p>
        </td></tr>
      </table>
      <p style="margin:18px 0 0;font-size:11px;color:#776E5D;font-family:Arial,sans-serif;">Little Quran Kids</p>
    </td></tr>
  </table>
</body></html>`;
}

export function inviteEmailText({
  guestName,
  eventTitle,
  whenText,
  venueText,
  url,
  lang = "en",
  deadlineText = "",
  registrationUrl = "",
  bodyText = "",
}) {
  const c = copyFor(lang);
  return [
    `${c.salam}${guestName ? `, ${guestName}` : ""},`,
    "",
    `${c.lead} ${eventTitle}.`,
    whenText ? whenText : null,
    venueText ? venueText : null,
    // The host's paragraphs, blank-line separated exactly as they were typed.
    ...(bodyParagraphs(bodyText).length ? ["", bodyParagraphs(bodyText).join("\n\n")] : []),
    "",
    `${c.cta}:`,
    url,
    deadlineText ? "" : null,
    deadlineText ? c.deadline(deadlineText) : null,
    registrationUrl ? "" : null,
    registrationUrl ? c.registerLead : null,
    registrationUrl || null,
    "",
    c.foot,
    "Little Quran Kids",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

