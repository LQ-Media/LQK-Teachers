import "server-only";

/* The Gemini transport, shared by everything in the portal that calls it.

   Extracted from lib/events/gemini.js when QR Registration needed the same
   client for a completely unrelated job (compositing a family photo). The
   PROMPTS belong to their features; the fetch, the timeout, the key handling
   and the "why did this come back empty" decoding are the same everywhere and
   were worth having in one place rather than two subtly different copies.

   Model-id notes, all learned the hard way on the Camel Caravan work:
   `gemini-2.5-flash` 404s for keys issued recently, so the alias
   `gemini-flash-latest` is the safe choice. It is a *thinking* model — the
   reasoning tokens come out of maxOutputTokens, so anything under ~2000
   returns an empty candidate that looks exactly like a refusal. */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
export const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-flash-latest";
export const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

export function geminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

/* Belt and braces: an API key must never reach a log line or a flash message,
   even echoed back inside an upstream error body. */
export function redact(text) {
  const key = process.env.GEMINI_API_KEY;
  let out = String(text);
  if (key) out = out.split(key).join("[REDACTED]");
  return out.replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED]");
}

export async function callGemini(model, body, { timeoutMs = 90_000 } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: "GEMINI_API_KEY is not set." };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let res;
  try {
    // Key in a header, never the query string — URLs land in access logs.
    res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    return {
      ok: false,
      error: err?.name === "AbortError" ? "Gemini timed out." : redact(err?.message || "Network error."),
    };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = redact(await res.text().catch(() => ""));
    return { ok: false, error: `Gemini ${res.status}: ${text.slice(0, 300)}` };
  }

  const json = await res.json().catch(() => null);
  const candidate = json?.candidates?.[0];
  if (!candidate || json?.promptFeedback?.blockReason) {
    return {
      ok: false,
      error: `Gemini declined the request (${json?.promptFeedback?.blockReason || candidate?.finishReason || "no candidate"}).`,
    };
  }
  // MAX_TOKENS on a thinking model means the budget went to reasoning and the
  // answer never arrived. Say so plainly — it reads as a refusal otherwise.
  if (candidate.finishReason === "MAX_TOKENS") {
    return { ok: false, error: "Gemini ran out of output budget before finishing." };
  }
  return { ok: true, candidate };
}


/** The first inline image part in a response, as {data, mime}, or null. */
export function imagePart(candidate) {
  const parts = candidate?.content?.parts || [];
  for (const part of parts) {
    const inline = part.inlineData || part.inline_data;
    if (inline?.data) return { data: inline.data, mime: inline.mimeType || inline.mime_type || "image/png" };
  }
  return null;
}

/** The concatenated text of a response, or "". */
export function textPart(candidate) {
  return (candidate?.content?.parts || []).map((p) => p.text || "").join("").trim();
}
