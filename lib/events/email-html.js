// Renders the invite email.
//
// Email HTML is not web HTML. This file is deliberately old-fashioned — nested
// tables, inline styles, no flexbox/grid, no webfonts, no external CSS —
// because Outlook renders through Word's engine and Gmail strips <style>
// blocks. Every constraint here is one of those clients, not a preference.
//
// The background image is NOT used as a CSS background: Outlook ignores
// background-image outright and Gmail's clipping is unreliable, so the header
// uses the image as a real <img> when there is one, and a solid accent bar
// otherwise. The full designed treatment lives on the hosted invite page,
// which the email's button links to.

import { t, fontEmail, dirFor, resolveAlign, isRtl } from "./design.js";
import { formatWhen } from "./format.js";

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Only http(s) links are ever emitted into href/src — a stored value must not
// be able to become javascript: or data: in a parent's mail client.
export function safeUrl(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  try {
    const url = new URL(s);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function row(label, value, design) {
  if (!value) return "";
  return `
    <tr>
      <td style="padding:0 0 14px 0;">
        <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${design.mutedColor};padding-bottom:3px;">${escapeHtml(label)}</div>
        <div style="font-size:15px;line-height:1.5;color:${design.textColor};">${escapeHtml(value).replace(/\n/g, "<br>")}</div>
      </td>
    </tr>`;
}

/**
 * @param {object} event   normalised event (see lib/events/store.js)
 * @param {object} opts    { inviteUrl, assetBase, recipientName }
 */
export function renderInviteEmail(event, { inviteUrl, assetBase = "", recipientName = "" } = {}) {
  const d = event.design;
  const s = t(event.language);
  const headingFont = fontEmail(d.headingFont, event.language);
  const bodyFont = fontEmail(d.bodyFont, event.language);
  const align = resolveAlign(d.align, event.language);
  const dir = dirFor(event.language);
  const rtl = isRtl(event.language);

  const logoUrl = d.showLogo && event.logoPath ? `${assetBase}/api/events/asset/${event.logoPath}` : "";
  const bgUrl = event.backgroundPath ? `${assetBase}/api/events/asset/${event.backgroundPath}` : "";
  const mapUrl = safeUrl(event.mapUrl);
  const link = safeUrl(inviteUrl);

  const greeting = recipientName ? `${escapeHtml(s.dear)} ${escapeHtml(recipientName)},` : "";

  const agendaRows = (event.agenda || [])
    .filter((a) => a.time || a.activity)
    .map(
      (a) => `
      <tr>
        <td style="padding:0 ${rtl ? "0" : "12px"} 8px ${rtl ? "12px" : "0"};white-space:nowrap;vertical-align:top;font-size:14px;color:${d.accentColor};font-weight:bold;">${escapeHtml(a.time)}</td>
        <td style="padding:0 0 8px 0;vertical-align:top;font-size:14px;color:${d.textColor};">${escapeHtml(a.activity)}</td>
      </tr>`
    )
    .join("");

  const venue = [event.venueName, event.venueAddress].filter(Boolean).join("\n");

  return `<!doctype html>
<html lang="${escapeHtml(event.language || "en")}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(event.title)}</title>
</head>
<!-- dir on both <html> and <body>: Outlook drops the one on <html>, and
     Gmail's web client rewrites the document wrapper entirely. -->
<body dir="${dir}" style="margin:0;padding:0;background:${d.pageColor};font-family:${bodyFont};-webkit-text-size-adjust:100%;">
  <!-- Preheader: the grey line of text next to the subject in most inboxes. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(event.tagline || event.title)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${d.pageColor};">
    <tr>
      <td align="center" style="padding:24px 12px;">

        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:${d.cardColor};border-radius:${d.cornerRadius}px;overflow:hidden;">

          ${
            bgUrl
              ? `<tr><td style="padding:0;font-size:0;line-height:0;">
                   <img src="${escapeHtml(bgUrl)}" width="600" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0;">
                 </td></tr>`
              : `<tr><td style="padding:0;font-size:0;line-height:0;height:8px;background:${d.accentColor};">&nbsp;</td></tr>`
          }

          <tr>
            <td align="${align}" style="padding:28px 32px 8px 32px;text-align:${align};">
              ${
                logoUrl
                  ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(event.hostName || "Little Quran Kids")}" width="72" style="display:inline-block;width:72px;max-width:72px;height:auto;border:0;margin-bottom:14px;">`
                  : ""
              }
              <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${d.accentColor};font-weight:bold;padding-bottom:6px;">${escapeHtml(s.youreInvited)}</div>
              <h1 style="margin:0;font-family:${headingFont};font-size:28px;line-height:1.25;color:${d.textColor};font-weight:bold;">${escapeHtml(event.title)}</h1>
              ${event.tagline ? `<p style="margin:8px 0 0 0;font-size:15px;line-height:1.5;color:${d.mutedColor};">${escapeHtml(event.tagline)}</p>` : ""}
            </td>
          </tr>

          ${
            greeting || event.body
              ? `<tr><td style="padding:16px 32px 0 32px;text-align:${align};">
                   ${greeting ? `<p style="margin:0 0 10px 0;font-size:15px;color:${d.textColor};">${greeting}</p>` : ""}
                   ${event.body ? `<p style="margin:0;font-size:15px;line-height:1.6;color:${d.textColor};">${escapeHtml(event.body).replace(/\n/g, "<br>")}</p>` : ""}
                 </td></tr>`
              : ""
          }

          <tr>
            <td style="padding:24px 32px 0 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${row(s.when, formatWhen(event.startsAt, event.endsAt, event.language), d)}
                ${row(s.where, venue, d)}
                ${row(s.dressCode, event.dressCode, d)}
                ${row(s.whatToBring, event.bring, d)}
                ${row(s.directions, event.directions, d)}
                ${row(s.parking, event.parking, d)}
              </table>
            </td>
          </tr>

          ${
            agendaRows
              ? `<tr><td style="padding:6px 32px 0 32px;">
                   <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${d.mutedColor};padding-bottom:8px;">${escapeHtml(s.programme)}</div>
                   <table role="presentation" dir="${dir}" cellpadding="0" cellspacing="0" border="0">${agendaRows}</table>
                 </td></tr>`
              : ""
          }

          ${
            link
              ? `<tr><td align="center" style="padding:28px 32px 8px 32px;">
                   <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                     <td align="center" bgcolor="${d.accentColor}" style="border-radius:999px;">
                       <a href="${escapeHtml(link)}" style="display:inline-block;padding:14px 30px;font-family:${bodyFont};font-size:16px;font-weight:bold;color:${d.buttonTextColor};text-decoration:none;border-radius:999px;">${escapeHtml(s.willYouCome)}</a>
                     </td>
                   </tr></table>
                   <p style="margin:12px 0 0 0;font-size:12px;color:${d.mutedColor};">${escapeHtml(s.viewInvite)}: <a href="${escapeHtml(link)}" style="color:${d.accentColor};">${escapeHtml(link)}</a></p>
                 </td></tr>`
              : ""
          }

          ${
            mapUrl
              ? `<tr><td align="center" style="padding:4px 32px 0 32px;">
                   <a href="${escapeHtml(mapUrl)}" style="font-size:14px;color:${d.accentColor};text-decoration:underline;">${escapeHtml(s.openInMaps)}</a>
                 </td></tr>`
              : ""
          }

          <tr>
            <td align="center" style="padding:26px 32px 30px 32px;">
              ${event.contactLine ? `<p style="margin:0 0 6px 0;font-size:13px;color:${d.mutedColor};">${escapeHtml(event.contactLine)}</p>` : ""}
              ${event.hostName ? `<p style="margin:0;font-size:13px;color:${d.mutedColor};">${escapeHtml(s.hostedBy)} ${escapeHtml(event.hostName)}</p>` : ""}
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Plain-text alternative. Sending multipart/alternative rather than HTML alone
// measurably helps deliverability, and some parents read mail in clients that
// show text only.
export function renderInviteText(event, { inviteUrl, recipientName = "" } = {}) {
  const s = t(event.language);
  const lines = [];
  if (recipientName) lines.push(`${recipientName},`, "");
  lines.push(s.youreInvited.toUpperCase(), event.title);
  if (event.tagline) lines.push(event.tagline);
  lines.push("");
  if (event.body) lines.push(event.body, "");

  const when = formatWhen(event.startsAt, event.endsAt, event.language);
  if (when) lines.push(`${s.when}: ${when}`);
  const venue = [event.venueName, event.venueAddress].filter(Boolean).join(", ");
  if (venue) lines.push(`${s.where}: ${venue}`);
  if (event.dressCode) lines.push(`${s.dressCode}: ${event.dressCode}`);
  if (event.bring) lines.push(`${s.whatToBring}: ${event.bring}`);
  if (event.directions) lines.push(`${s.directions}: ${event.directions}`);
  if (event.parking) lines.push(`${s.parking}: ${event.parking}`);

  if (event.agenda?.length) {
    lines.push("", s.programme);
    for (const a of event.agenda) lines.push(`  ${a.time}  ${a.activity}`);
  }

  const map = safeUrl(event.mapUrl);
  if (map) lines.push("", `${s.openInMaps}: ${map}`);

  const link = safeUrl(inviteUrl);
  if (link) lines.push("", `${s.willYouCome}`, link);

  if (event.contactLine) lines.push("", event.contactLine);
  if (event.hostName) lines.push(`${s.hostedBy} ${event.hostName}`);

  return lines.join("\n");
}
