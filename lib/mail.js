import "server-only";

/* Email delivery via the Resend HTTPS API — the one transport this portal has.

   HTTPS, not SMTP, and not by preference: Railway BLOCKS outbound SMTP on 587,
   465 and 2525 (proven by testing from inside the container on the Parents
   portal). Nodemailer will hang until timeout here. Do not "fix" this by adding
   an SMTP transport.

   ⚠️ Resend's free tier is 100 emails/DAY and 3,000/month, shared across the
   whole account — the Parents portal draws from the same pool. A 200-guest
   event cannot be sent in one afternoon on the free tier; sendBatch reports
   quota failures per-recipient so a partial send is visible rather than silent.

   This module is deliberately feature-agnostic. Event invitations (which is
   what it was written for) live in lib/events/mail.js, and password-reset mail
   in lib/auth/mail.js — both build their own copy and hand it to sendMail. */

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

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

export function escapeAttr(s) {
  return escapeHtml(s);
}

/* The public origin the portal is reachable at. Email links and OAuth redirect
   URIs are both resolved by something OUTSIDE this process — an inbox, or
   Google's consent screen — so neither can use a relative path or trust the
   request's Host header. Set LQK_PUBLIC_BASE_URL on any deploy that isn't the
   live domain, or every link mailed out will point at production. */
export function baseUrl() {
  return (process.env.LQK_PUBLIC_BASE_URL || "https://teachers.littlequrankids.sg").replace(/\/+$/, "");
}
