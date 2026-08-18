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

   THE LIVE TEMPLATE IS THE 3-PARAMETER ONE. {{3}} is the invitation URL:

     Assalamu'alaikum {{1}},
     You're invited to {{2}}.
     Please let us know if you can join us by clicking the link here: {{3}}

     _*Attendance is mandatory for all LQK students.*_

   The Malay twin is registered under the same name + "_ms" (e.g.
   event_invitation_ms) with the same three parameters.

   ⚠️ THIS CODE ONCE SENT FOUR. A rewrite added a reply-by date as {{3}} and
   pushed the URL to {{4}}, but the new body was never approved by Meta — so
   Wati kept substituting the LIVE three-parameter template, put the reply-by
   text into the link slot, and silently dropped the fourth parameter. Families
   received "clicking the link here: soon" with no link at all, and the send
   still reported success, because Wati answers 200 for a message it has
   quietly truncated. The parameter list here must match the body APPROVED IN
   WATI, not the body we would like to have.

   To move to the four-parameter version later: register and get the body below
   approved FIRST, confirm it is live in Wati, and only then add the reply-by
   date back into the params array in sendInviteWhatsApp.

     Assalamu'alaikum {{1}},

     We would like to invite you and your family to {{2}}.

     We'd love your family to join us. Tap the link below to see your invitation and reply by {{3}}:
     {{4}}

   ⚠️ In EITHER body, do not put a full stop directly after the URL parameter.
   Several WhatsApp clients extend the auto-detected link to include trailing
   punctuation, so "…/i/abc123." resolves to a token with a dot on the end and
   the guest lands on "this invitation isn't valid".

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

/* What a template parameter is allowed to contain.

   The values here are admin-typed (an event title) and Meta is strict about
   them in ways that fail the WHOLE message rather than the one field:

     - Curly braces read as placeholder syntax. An event titled
       "{1} Test Maulid 2026" reached a guest verbatim as "{1} Test Maulid
       2026", and a title carrying "{{4}}" could shift substitution onto the
       wrong slot entirely.
     - Newlines and tabs are rejected outright by the send endpoint.
     - Empty values are rejected — every slot must carry something.

   Cleaning here rather than at the call sites means every future template send
   inherits it, and an admin can name an event whatever they like without it
   becoming a WhatsApp problem. */
export function cleanParam(value, fallback = "-") {
  const text = String(value ?? "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1024);
  return text || fallback;
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
        parameters: params.map((value, i) => ({ name: String(i + 1), value: cleanParam(value) })),
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
   reaches those families better than silence.

   THREE parameters, matching the approved body above. The reply-by date is not
   one of them: the invitation page and the email both carry it, and adding it
   here means a template change and a fresh Meta approval first. */
export async function sendInviteWhatsApp({ phone, guestName, eventTitle, url, lang }) {
  const base = process.env.WATI_TEMPLATE_NAME || "event_invitation";
  const templateName = lang === "ms" ? `${base}_ms` : base;

  // The whole point of the message is the link. Refusing beats sending an
  // invitation a family cannot open — which is precisely how this broke.
  if (!String(url || "").trim()) return { ok: false, error: "missing invitation link" };

  return sendTemplate({ phone, templateName, params: [guestName, eventTitle, url] });
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
