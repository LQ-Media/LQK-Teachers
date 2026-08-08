import "server-only";
import nodemailer from "nodemailer";

// Google Workspace SMTP.
//
// Two things about Workspace shape this file:
//
//  1. It needs an APP PASSWORD, not the account password — 2-Step Verification
//     must be on for the sending account, then generate one at
//     https://myaccount.google.com/apppasswords. A normal password fails with
//     "Username and Password not accepted" no matter how correct it is.
//
//  2. It enforces a daily recipient cap (~2,000/day for Workspace, 500 for a
//     free gmail.com account) and throttles bursts. So invites go out one
//     message per parent with a pause between them, never one BCC blast:
//     personalised greetings need it anyway, and a 300-address BCC is a
//     spam-filter magnet.

const MISSING = "SMTP is not configured — set SMTP_USER and SMTP_PASSWORD (a Google app password) in the environment.";

export function mailerConfigured() {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASSWORD);
}

let transport;

function getTransport() {
  if (!mailerConfigured()) throw new Error(MISSING);
  if (transport) return transport;

  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    // 465 is implicit TLS; 587 upgrades via STARTTLS.
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
    // Reuse one connection for the whole send rather than reconnecting per
    // parent — Google rate-limits connection churn harder than messages.
    pool: true,
    maxConnections: 1,
    maxMessages: 100,
  });
  return transport;
}

// Gmail rewrites the From address to the authenticated account unless the
// address is a verified alias ("Send mail as"), so SMTP_FROM defaults to the
// login rather than to something that would be silently replaced.
export function fromAddress() {
  const name = process.env.SMTP_FROM_NAME || "Little Quran Kids";
  const address = process.env.SMTP_FROM || process.env.SMTP_USER || "";
  return address ? `"${name.replace(/"/g, "")}" <${address}>` : name;
}

export async function sendMail({ to, subject, html, text, replyTo }) {
  const info = await getTransport().sendMail({
    from: fromAddress(),
    to,
    subject,
    html,
    text,
    replyTo: replyTo || process.env.SMTP_REPLY_TO || undefined,
  });
  return info;
}

// Proves the credentials work before a send goes anywhere near the parent list.
export async function verifyMailer() {
  if (!mailerConfigured()) return { ok: false, error: MISSING };
  try {
    await getTransport().verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}
