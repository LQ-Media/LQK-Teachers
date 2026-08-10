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

   Register the template with this body (3 parameters):

     Assalamu'alaikum {{1}}, you're invited to {{2}}.
     Please view your invitation and let us know if you can join us: {{3}}

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

export async function sendInviteWhatsApp({ phone, guestName, eventTitle, url }) {
  return sendTemplate({ phone, params: [guestName, eventTitle, url] });
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
