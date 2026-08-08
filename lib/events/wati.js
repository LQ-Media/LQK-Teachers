import "server-only";

// WATI — WhatsApp Business API.
//
// WhatsApp does not carry HTML, and it does not let a business message a
// parent with free-form text outside a 24-hour customer-service window. An
// unprompted invite is therefore a TEMPLATE message: wording pre-registered in
// the WATI dashboard and approved by Meta, with {{1}}, {{2}}… placeholders
// this code fills in. There is no way around that step from here — an
// unapproved template name returns an error, and free-form blasting gets the
// business number banned.
//
// The template must therefore be created once in WATI before the first send.
// docs/EVENTS.md carries the exact wording to submit and the parameter order
// this file sends.
//
// API shape (WATI v1):
//   POST {WATI_API_ENDPOINT}/api/v1/sendTemplateMessage?whatsappNumber=<digits>
//   Authorization: Bearer <token>
//   { template_name, broadcast_name, parameters: [{ name, value }, ...] }

const MISSING = "WhatsApp is not configured — set WATI_API_ENDPOINT, WATI_ACCESS_TOKEN and WATI_TEMPLATE_NAME in the environment.";

export function watiConfigured() {
  return Boolean(process.env.WATI_API_ENDPOINT && process.env.WATI_ACCESS_TOKEN && process.env.WATI_TEMPLATE_NAME);
}

export function watiTemplateName() {
  return process.env.WATI_TEMPLATE_NAME || "";
}

// The dashboard shows the endpoint as e.g.
// https://live-mt-server.wati.io/1234567 — tolerate a trailing slash or an
// accidentally-included /api/v1 suffix rather than failing cryptically.
function baseUrl() {
  return String(process.env.WATI_API_ENDPOINT || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api\/v\d+$/, "");
}

// The token is sometimes copied out of the dashboard already carrying its
// "Bearer " prefix.
function authHeader() {
  const token = String(process.env.WATI_ACCESS_TOKEN || "").trim();
  return /^bearer\s/i.test(token) ? token : `Bearer ${token}`;
}

/**
 * Send one approved template message.
 *
 * @param {string} phone       digits only, with country code, no '+'
 * @param {Array<{name:string,value:string}>} parameters
 * @param {string} broadcastName groups the sends in WATI's reporting
 */
export async function sendTemplateMessage(phone, parameters, broadcastName) {
  if (!watiConfigured()) throw new Error(MISSING);

  const to = String(phone || "").replace(/\D/g, "");
  if (!to) throw new Error("No usable phone number");

  const url = `${baseUrl()}/api/v1/sendTemplateMessage?whatsappNumber=${encodeURIComponent(to)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      template_name: watiTemplateName(),
      broadcast_name: String(broadcastName || watiTemplateName()).slice(0, 60),
      parameters,
    }),
    // A hung WhatsApp call must not stall the whole parent list.
    signal: AbortSignal.timeout(20000),
  });

  const raw = await res.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    body = { raw };
  }

  if (!res.ok) {
    throw new Error(`WATI ${res.status}: ${(body?.message || body?.info || raw || "").toString().slice(0, 200)}`);
  }
  // WATI answers 200 with { result: false, info: "..." } for per-message
  // failures (unopted number, template not approved), so status alone is not
  // proof of delivery.
  if (body && body.result === false) {
    throw new Error(String(body.info || body.message || "WATI rejected the message").slice(0, 200));
  }

  return { id: body?.message?.localMessageId || body?.localMessageId || null };
}
