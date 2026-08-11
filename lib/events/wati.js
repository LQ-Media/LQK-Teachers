import "server-only";

/* WhatsApp delivery via Wati.

   ⚠️ READ THIS BEFORE DEBUGGING A FAILED SEND.

   You cannot send free-form WhatsApp text to someone who has not messaged you
   in the last 24 hours. Every invite is therefore a *template* message: the
   text is pre-registered with Meta, approved (24–48h), and filled in at send
   time with positional parameters. If sends fail with a template error, the
   cause is almost always one of:

     1. The template name in WATI_TEMPLATE_NAME doesn't match Wati exactly
        (it is case-sensitive and uses snake_case).
     2. The parameter COUNT doesn't match the approved body. Meta rejects the
        whole message if you send 2 params to a 3-param template.
     3. The template is still pending review, or was rejected.

   The body to register (4 positional parameters — {{3}} is the reply-by date,
   {{4}} is the URL). ⚠️ This REPLACES the old 3-param template whose {{3}} was
   the link and which ended "_*Attendance is mandatory for all LQK students.*_"
   — that line contradicted asking whether the family can come and is gone for
   good. Submit to Meta early: approval takes 24–48h, and until the new body is
   approved, sends through this code will fail with a parameter-count error
   (visible per guest in the send results).

     Assalamu'alaikum {{1}},

     We would like to invite you and your family to {{2}}.

     We'd love your family to join us. Tap the link below to see your invitation and reply by {{3}}:
     {{4}}

   Register a Malay twin under the same name + "_ms" (e.g. event_invitation_ms):

     Assalamu'alaikum {{1}},

     Kami ingin menjemput anda sekeluarga ke {{2}}.

     Kami berbesar hati jika keluarga anda dapat hadir. Tekan pautan di bawah untuk melihat jemputan dan balas sebelum {{3}}:
     {{4}}

   ⚠️ Do NOT put a full stop directly after {{4}}. Several WhatsApp clients
   extend the auto-detected link to include trailing punctuation, so
   "…/i/abc123." resolves to a token with a dot on the end and the guest lands
   on "this invitation isn't valid". Leave the URL alone on its own line.

   Category: MARKETING. Utility gets cheaper routing but Meta reclassifies
   invitations as marketing anyway, and a mismatch risks the template being
   pulled mid-campaign.

   Sending is a no-op when unconfigured — this returns {ok:false, skipped:true}
   rather than throwing, so the admin UI can show "email sent, WhatsApp not
   configured" instead of failing the whole batch. */

export function watiConfigured() {
  return !!(process.env.WATI_API_URL && process.env.WATI_ACCESS_TOKEN);
}

function baseUrl() {
  return (process.env.WATI_API_URL || "").replace(/\/+$/, "");
}

/* Wati wants the number WITHOUT a leading "+" on the send endpoint, even though
   every other part of their API shows it with one. */
function watiNumber(e164) {
  return String(e164 || "").replace(/^\+/, "");
}

export async function sendTemplate({ phone, params, templateName }) {
  if (!watiConfigured()) return { ok: false, skipped: true, error: "Wati is not configured" };
  const number = watiNumber(phone);
  if (!number) return { ok: false, error: "missing phone" };

  const name = templateName || process.env.WATI_TEMPLATE_NAME || "event_invitation";
  const token = process.env.WATI_ACCESS_TOKEN;
  const url = `${baseUrl()}/api/v1/sendTemplateMessage?whatsappNumber=${encodeURIComponent(number)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        template_name: name,
        broadcast_name: `${name}_${new Date().toISOString().slice(0, 10)}`,
        parameters: params.map((value, i) => ({ name: String(i + 1), value: String(value ?? "") })),
      }),
    });
    const body = await res.json().catch(() => ({}));
    // Wati answers 200 with {result:false} on template errors — status alone lies.
    if (!res.ok || body?.result === false) {
      return { ok: false, error: body?.info || body?.message || `Wati returned ${res.status}` };
    }
    return { ok: true, id: body?.id || null };
  } catch (err) {
    return { ok: false, error: err?.message || "network error" };
  }
}

/* Template picked by the guest's language: "_ms" twin for Malay, the base
   (English) for everyone else — no Arabic template is registered, and English
   reaches those families better than silence. `deadlineText` is already
   localised by the caller; Meta rejects empty parameters, so it falls back to
   the event date or a soft "soon" in the right language. */
export async function sendInviteWhatsApp({ phone, guestName, eventTitle, url, deadlineText, lang }) {
  const base = process.env.WATI_TEMPLATE_NAME || "event_invitation";
  const templateName = lang === "ms" ? `${base}_ms` : base;
  const fallback = lang === "ms" ? "segera" : "soon";
  return sendTemplate({
    phone,
    templateName,
    params: [guestName, eventTitle, deadlineText || fallback, url],
  });
}

export async function sendBatch(messages, { delayMs = 250 } = {}) {
  const results = [];
  for (const msg of messages) {
    const result = await sendInviteWhatsApp(msg);
    results.push({ phone: msg.phone, ...result });
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  }
  return results;
}
