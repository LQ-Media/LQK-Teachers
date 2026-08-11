import { createHmac, timingSafeEqual } from "node:crypto";

/* Pure helpers for the LQK store (lqkstore.littlequrankids.sg) contribution
   flow. Kept free of "server-only" and free of fetch/db so they can be unit
   tested — the server wrapper in ./shopify.js owns the network and the cache.

   WHY THE STOREFRONT, NOT THE ADMIN API: this Mac's Shopify CLI login has no
   Admin-API access to the store and no token exists (see the store's own
   deploys — everything ships via the CLI's theme push). The public storefront
   endpoints are enough for the whole flow:

     - /products/<handle>.js       → title, price (CENTS), image, variants
     - /cart/<variant>:<qty>?attributes[…]=… → straight into checkout, with
       cart attributes that Shopify copies onto the order as note_attributes

   Payment confirmation comes back the one way Shopify offers without an API:
   an "Order payment" webhook created by hand in the store admin (Settings →
   Notifications → Webhooks), verified here by HMAC. */

export const DEFAULT_STORE_ORIGIN = "https://lqkstore.littlequrankids.sg";

export function storeOrigin() {
  return (process.env.LQK_STORE_ORIGIN || DEFAULT_STORE_ORIGIN).replace(/\/+$/, "");
}

/* Accepts whatever an admin pastes for "the product": a full product URL (with
   or without ?variant=), a bare /products/<handle> path, or just the handle.
   Returns { handle, variantId } or null. Deliberately forgiving about origin —
   the myshopify.com domain serves the same product pages. */
export function parseProductRef(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;

  // Bare handle: letters/digits/dashes, no slashes or spaces.
  if (/^[a-z0-9][a-z0-9-]*$/i.test(raw)) return { handle: raw.toLowerCase(), variantId: null };

  let url;
  try {
    url = new URL(raw, storeOrigin());
  } catch {
    return null;
  }
  const match = /\/products\/([a-z0-9-]+)/i.exec(url.pathname);
  if (!match) return null;
  const variant = url.searchParams.get("variant");
  return {
    handle: match[1].toLowerCase(),
    variantId: variant && /^\d+$/.test(variant) ? variant : null,
  };
}

/* Picks the variant the guest will be charged for: the admin's ?variant= if it
   exists on the product, otherwise the first available one, otherwise the
   first. Never null for a product with variants. */
export function pickVariant(product, wantedId) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  if (!variants.length) return null;
  if (wantedId) {
    const wanted = variants.find((v) => String(v.id) === String(wantedId));
    if (wanted) return wanted;
  }
  return variants.find((v) => v.available) || variants[0];
}

/* Shopify storefront prices are integer CENTS. */
export function formatPrice(cents, currency = "SGD") {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "";
  return `${currency} ${(n / 100).toFixed(2)}`;
}

/* The cart permalink that goes straight to checkout, tagged so the paid order
   can be traced back to the invitation.

   Only the FIRST 8 CHARS of the token travel — cart attributes appear on the
   order to store staff and in confirmation emails, and the full token is the
   guest's whole credential. 8 hex chars + the event id is plenty to find the
   guest again and useless for opening their invitation. */
export function contributionCheckoutUrl({ variantId, token, eventId, qty = 1 }) {
  const params = new URLSearchParams({
    "attributes[invite]": String(token).slice(0, 8),
    "attributes[event]": String(eventId),
  });
  return `${storeOrigin()}/cart/${variantId}:${Math.max(1, qty)}?${params}`;
}

/* Webhook HMAC per Shopify: base64(HMAC-SHA256(secret, raw body)) compared in
   constant time. The RAW request body, before any JSON parse — re-serialising
   changes the bytes and the comparison will fail forever. */
export function verifyShopifyHmac(rawBody, hmacHeader, secret) {
  if (!secret || !hmacHeader) return false;
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let given;
  try {
    given = Buffer.from(String(hmacHeader), "base64");
  } catch {
    return false;
  }
  if (given.length !== digest.length) return false;
  return timingSafeEqual(digest, given);
}

/* Pulls our two attributes back off a webhook order payload. Shopify sends
   cart attributes as note_attributes: [{name, value}]. */
export function orderInviteRef(order) {
  const attrs = Array.isArray(order?.note_attributes) ? order.note_attributes : [];
  const get = (name) => {
    const hit = attrs.find((a) => a?.name === name);
    return hit ? String(hit.value || "").trim() : "";
  };
  const invite = get("invite");
  const event = get("event");
  if (!/^[0-9a-f]{8}$/i.test(invite) || !event) return null;
  return { tokenPrefix: invite.toLowerCase(), eventId: event };
}
