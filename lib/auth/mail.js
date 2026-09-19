import "server-only";
import { escapeAttr, escapeHtml } from "@/lib/mail";
import { RESET_TTL_MINUTES } from "./reset";

/* The password-reset email.

   Same shape as the event invitation card (lib/events/mail.js): table-based and
   inline-styled, because that is still what Outlook's Word renderer and Gmail
   understand. Kept short on purpose — a reset email that reads like marketing
   is a reset email people report as phishing.

   The raw link is printed under the button as well. Some corporate mail
   gateways rewrite or strip button hrefs, and a teacher who can't reset their
   password has no other way in. */

export function resetEmailSubject() {
  return "Reset your LQK Teachers Portal password";
}

export function resetEmailHtml({ name, url, ttlMinutes = RESET_TTL_MINUTES }) {
  const greeting = name ? `Assalamu'alaikum, ${escapeHtml(name)}` : "Assalamu'alaikum";
  return `<!doctype html>
<html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#FBF6EC;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Reset your password — this link works once and expires in ${ttlMinutes} minutes.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF6EC;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:1px solid #E8DDC5;border-radius:20px;">
        <tr><td style="padding:28px 24px;font-family:Arial,sans-serif;color:#3B372B;">
          <p style="margin:0 0 12px;font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#96681A;">${greeting}</p>
          <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#3B372B;font-weight:bold;font-family:Georgia,'Times New Roman',serif;">Reset your password</h1>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#3B372B;">Someone asked to reset the password for your Teachers Portal account. Tap the button to choose a new one.</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
            <tr><td style="border-radius:999px;background:#96681A;">
              <a href="${escapeAttr(url)}" style="display:inline-block;padding:14px 26px;font-size:14px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:999px;">Choose a new password</a>
            </td></tr>
          </table>
          <p style="margin:0 0 20px;font-size:12px;line-height:1.6;color:#776E5D;">Button not working? Paste this into your browser:<br><a href="${escapeAttr(url)}" style="color:#96681A;word-break:break-all;">${escapeHtml(url)}</a></p>
          <p style="margin:0;font-size:12px;line-height:1.6;color:#776E5D;border-top:1px solid #E8DDC5;padding-top:16px;">This link works once and expires in ${ttlMinutes} minutes. <strong>If you didn't ask for this, you can ignore this email</strong> — your password hasn't changed.</p>
        </td></tr>
      </table>
      <p style="margin:18px 0 0;font-size:11px;color:#776E5D;font-family:Arial,sans-serif;">Little Quran Kids</p>
    </td></tr>
  </table>
</body></html>`;
}

export function resetEmailText({ name, url, ttlMinutes = RESET_TTL_MINUTES }) {
  return [
    name ? `Assalamu'alaikum, ${name},` : "Assalamu'alaikum,",
    "",
    "Someone asked to reset the password for your LQK Teachers Portal account.",
    "Open this link to choose a new one:",
    "",
    url,
    "",
    `This link works once and expires in ${ttlMinutes} minutes.`,
    "If you didn't ask for this, you can ignore this email — your password hasn't changed.",
    "",
    "Little Quran Kids",
  ].join("\n");
}
