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

/* Which variant a GUEST'S choice resolves to.

   Most LQK contribution products are tiered — "$30 Community Sponsor",
   "$50 Family Sponsor", "$100 Supporter Set A" — and the family picks their
   tier on the invitation. That choice arrives from the client, so it is only
   ever a LOOKUP KEY here: an id that isn't on this product falls back to the
   default rather than being trusted into a checkout URL.

   A variant pinned by the admin (?variant= on the product link) is the event's
   decision and outranks anything the guest sends — that is what makes a
   pinned link a FIXED contribution instead of a menu. */
export function chooseVariant(product, pinnedId, requestedId) {
  if (pinnedId) {
    const pinned = pickVariant(product, pinnedId);
    // Only honour the pin when it really is this product's variant; a stale id
    // (variant deleted in the store) must not freeze the guest on nothing.
    if (pinned && String(pinned.id) === String(pinnedId)) return pinned;
  }
  return pickVariant(product, requestedId);
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

/* ---- attendee registrations (LQK Maulid 2026 and kin) -------------------- */

/* The product page's attendee form (docs/shopify/lqk-attendee-fields.liquid)
   submits one group of details per place as LINE ITEM PROPERTIES:

     Main Attendee Name / Email / Phone          (the buyer's own place)
     Attendee 2 Name / Email / Phone             (and 3, 4, …)

   This walks every line item's properties back into ordered groups. Anything
   else in properties — other apps also write there — is ignored, and a group
   the shopper somehow submitted entirely blank is dropped rather than shown
   as an empty seat. Order of the properties array is NOT trusted; the index
   in the property name is the order. */
const ATTENDEE_PROP = /^(?:Main Attendee|Attendee ([2-9]|[1-9]\d)) (Name|Email|Phone)$/;
const MAX_ORDER_ATTENDEES = 200;

export function orderAttendees(order) {
  const items = Array.isArray(order?.line_items) ? order.line_items : [];
  const out = [];
  for (const item of items) {
    const props = Array.isArray(item?.properties) ? item.properties : [];
    const groups = new Map(); // index (1 = main) -> {name, email, phone}
    for (const prop of props) {
      const match = ATTENDEE_PROP.exec(String(prop?.name || "").trim());
      if (!match) continue;
      const index = match[1] ? Number(match[1]) : 1;
      const group = groups.get(index) || { name: "", email: "", phone: "" };
      group[match[2].toLowerCase()] = String(prop?.value ?? "").trim().slice(0, 300);
      groups.set(index, group);
    }
    for (const index of [...groups.keys()].sort((a, b) => a - b)) {
      const group = groups.get(index);
      if (group.name || group.email || group.phone) {
        out.push({ ...group, main: index === 1 });
        if (out.length >= MAX_ORDER_ATTENDEES) return out;
      }
    }
  }
  return out;
}

/* The order-level snapshot stored alongside those attendees — shaped here so
   the webhook route stays a thin pipe and this stays unit-testable. Everything
   is defensive: webhook payload fields go missing across API versions, and a
   half-empty row in the portal beats a crashed webhook that Shopify then
   retries for days. */
export function storeOrderRecord(order, attendees) {
  const items = Array.isArray(order?.line_items) ? order.line_items : [];
  const title = (item) =>
    [item.title, item.variant_title && item.variant_title !== "Default Title" ? item.variant_title : null]
      .filter(Boolean)
      .join(" — ");
  const customer = order?.customer || {};
  return {
    orderId: String(order?.id ?? ""),
    // order_number is the "#1024" humans quote at the door; the raw id is only
    // for Shopify admin URLs.
    orderNumber: String(order?.order_number ?? order?.name ?? "").replace(/^#/, ""),
    lineTitle: items.map(title).filter(Boolean).join(" + ").slice(0, 300) || null,
    qty: items.reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0) || null,
    amount: String(order?.current_total_price || order?.total_price || "").slice(0, 40) || null,
    currency: String(order?.currency || "").slice(0, 8) || null,
    customerName:
      [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim().slice(0, 200) || null,
    customerEmail: String(order?.email || customer.email || "").trim().slice(0, 300) || null,
    paidAt: order?.processed_at || order?.created_at || null,
    attendees,
  };
}
