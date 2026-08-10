import "server-only";

/* Email delivery via the Resend HTTPS API.

   HTTPS, not SMTP, and not by preference: Railway BLOCKS outbound SMTP on 587,
   465 and 2525 (proven by testing from inside the container on the Parents
   portal). Nodemailer will hang until timeout here. Do not "fix" this by adding
   an SMTP transport.

   ⚠️ Resend's free tier is 100 emails/DAY and 3,000/month, shared across the
   whole account — the Parents portal draws from the same pool. A 200-guest
   event cannot be sent in one afternoon on the free tier; sendBatch reports
   quota failures per-recipient so a partial send is visible rather than silent. */

const ENDPOINT = "https://api.resend.com/emails";

export function mailConfigured() {
  return !!process.env.RESEND_API_KEY;
}

export async function sendMail({ to, subject, html, text, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY is not set" };

  const from = process.env.MAIL_FROM || "Little Quran Kids <no-reply@littlequrankids.sg>";
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        ...(text ? { text } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: body?.message || `Resend returned ${res.status}` };
    }
    return { ok: true, id: body?.id };
  } catch (err) {
    return { ok: false, error: err?.message || "network error" };
  }
}

/* Sequential, not Promise.all. Resend rate-limits bursts, and a rejected batch
   is indistinguishable from a delivered one at the call site — one slow loop
   with per-guest results beats a fast one that lies about what arrived. */
export async function sendBatch(messages, { delayMs = 120 } = {}) {
  const results = [];
  for (const msg of messages) {
    const result = await sendMail(msg);
    results.push({ to: msg.to, ...result });
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  }
  return results;
}

/* The email is a CARD, not the invitation.

   Sending the full design as HTML email would mean Gmail clipping it at 102KB,
   Outlook's Word renderer destroying the layout, and no way to fix a typo after
   send. The card carries the essentials and a button; the invitation itself
   lives at the link, where it can be edited after the fact and rendered
   identically for every guest. Table-based and inline-styled because that is
   still what email clients understand. */
export function inviteEmailHtml({ guestName, eventTitle, whenText, venueText, url, accent = "#96681A", lang = "en" }) {
  const dir = lang === "ar" ? "rtl" : "ltr";
  const copy = {
    en: { lead: "You're invited to", cta: "View your invitation & reply", foot: "This invitation is personal to you — please don't forward the link." },
    ms: { lead: "Anda dijemput ke", cta: "Lihat jemputan & balas", foot: "Jemputan ini khusus untuk anda — sila jangan kongsi pautan ini." },
    ar: { lead: "أنتم مدعوون إلى", cta: "عرض الدعوة والرد", foot: "هذه الدعوة خاصة بكم — نرجو عدم مشاركة الرابط." },
  }[lang] || null;
  const c = copy || { lead: "You're invited to", cta: "View your invitation & reply", foot: "This invitation is personal to you — please don't forward the link." };

  return `<!doctype html>
<html dir="${dir}" lang="${lang}"><body style="margin:0;padding:0;background:#FBF6EC;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF6EC;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:1px solid #E8DDC5;border-radius:20px;overflow:hidden;">
        <tr><td style="padding:36px 32px 28px;text-align:center;font-family:Georgia,'Times New Roman',serif;color:#3B372B;" dir="${dir}">
          <p style="margin:0 0 10px;font-size:13px;letter-spacing:1.6px;text-transform:uppercase;color:#776E5D;font-family:Arial,sans-serif;">${escapeHtml(c.lead)}</p>
          <h1 style="margin:0 0 18px;font-size:28px;line-height:1.25;color:#3B372B;font-weight:normal;">${escapeHtml(eventTitle)}</h1>
          <p style="margin:0 0 4px;font-size:15px;color:#3B372B;font-family:Arial,sans-serif;">${escapeHtml(guestName)}</p>
          ${whenText ? `<p style="margin:14px 0 0;font-size:15px;color:#3B372B;font-family:Arial,sans-serif;">${escapeHtml(whenText)}</p>` : ""}
          ${venueText ? `<p style="margin:4px 0 0;font-size:15px;color:#776E5D;font-family:Arial,sans-serif;">${escapeHtml(venueText)}</p>` : ""}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto 0;">
            <tr><td style="border-radius:999px;background:${accent};">
              <a href="${escapeAttr(url)}" style="display:inline-block;padding:14px 30px;font-family:Arial,sans-serif;font-size:15px;color:#FFFFFF;text-decoration:none;border-radius:999px;">${escapeHtml(c.cta)}</a>
            </td></tr>
          </table>
          <p style="margin:26px 0 0;font-size:12px;line-height:1.6;color:#776E5D;font-family:Arial,sans-serif;">${escapeHtml(c.foot)}</p>
        </td></tr>
      </table>
      <p style="margin:18px 0 0;font-size:11px;color:#776E5D;font-family:Arial,sans-serif;">Little Quran Kids</p>
    </td></tr>
  </table>
</body></html>`;
}

export function inviteEmailText({ guestName, eventTitle, whenText, venueText, url }) {
  return [
    `${guestName},`,
    "",
    `You're invited to ${eventTitle}.`,
    whenText ? whenText : null,
    venueText ? venueText : null,
    "",
    "View your invitation and reply:",
    url,
    "",
    "This invitation is personal to you — please don't forward the link.",
    "Little Quran Kids",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function escapeAttr(s) {
  return escapeHtml(s);
}
