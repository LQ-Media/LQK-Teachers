import "server-only";
import { parseProductRef, pickVariant, formatPrice, storeOrigin } from "./shopify-core";

/* Server side of the store integration: fetch a product's live details from
   the public storefront JSON. See shopify-core.js for why there is no Admin
   API anywhere in this flow.

   Cached in-process for five minutes. The guest page is force-dynamic, so
   without this every invitation open would hit the store; with it a 200-guest
   send costs a handful of product fetches. A stale price for five minutes is
   fine — checkout charges the store's real price regardless. */

const TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // handle -> { at, data }

/* Whether a payment can ever be CONFIRMED.

   Without the webhook secret, /api/events/shopify answers 503 to every order
   and contribution_status never leaves 'pending' — so an attending family pays,
   comes back, and can never complete their reply. That failure is silent on
   both sides, which is exactly why the admin page asks this question out loud
   before a single invitation goes out. */
export function contributionWebhookConfigured() {
  return !!process.env.SHOPIFY_EVENTS_WEBHOOK_SECRET;
}

export async function getContributionProduct(ref) {
  const parsed = parseProductRef(ref);
  if (!parsed) return null;

  const hit = cache.get(parsed.handle);
  const now = Date.now();
  let data = hit && now - hit.at < TTL_MS ? hit.data : null;

  if (!data) {
    try {
      const res = await fetch(`${storeOrigin()}/products/${parsed.handle}.js`, {
        // Belt and braces alongside the Map: Next's fetch cache dedupes
        // concurrent renders; the Map covers the TTL between requests.
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!res.ok) return stale(parsed);
      data = await res.json();
      cache.set(parsed.handle, { at: now, data });
    } catch {
      return stale(parsed);
    }
  }

  return shape(data, parsed);
}

/* On a fetch failure, an expired cache entry beats showing the guest nothing —
   the price on the card is informational; checkout charges the truth. */
function stale(parsed) {
  const hit = cache.get(parsed.handle);
  if (!hit) return null;
  return shape(hit.data, parsed);
}

/* The one place a storefront payload becomes the object the invitation renders.
   Shared by the live and the stale path so the two can never drift — they did,
   once, and only the live one learned about variants.

   `variants` carries the WHOLE tier list because LQK's contribution products
   are tiered ($30 / $50 / $100 / $300) and the family chooses their own. The
   top-level variantId/priceText remain the DEFAULT — what the card shows before
   the guest touches anything, and what a pinned link locks the event to. */
function shape(data, parsed) {
  const variants = Array.isArray(data?.variants) ? data.variants : [];
  const chosen = pickVariant(data, parsed.variantId);
  if (!chosen) return null;

  // A pin only counts when the id is really on this product — a variant deleted
  // in the store must degrade to "guest picks", not to a dead checkout link.
  const pinned = !!parsed.variantId && String(chosen.id) === String(parsed.variantId);

  return {
    handle: parsed.handle,
    title: data.title || parsed.handle,
    variantId: String(chosen.id),
    variantTitle: variantTitle(chosen),
    priceCents: Number(chosen.price) || 0,
    priceText: formatPrice(chosen.price),
    available: chosen.available !== false,
    image: imageUrl(chosen.featured_image?.src || data.featured_image),
    url: `${storeOrigin()}/products/${parsed.handle}`,
    pinned,
    // Pinned means the event fixed the amount, so there is nothing to choose:
    // sending one variant keeps the guest page from rendering a picker at all.
    variants: (pinned ? [chosen] : variants).map((v) => ({
      id: String(v.id),
      title: variantTitle(v) || data.title || parsed.handle,
      priceCents: Number(v.price) || 0,
      priceText: formatPrice(v.price),
      available: v.available !== false,
      image: imageUrl(v.featured_image?.src),
    })),
  };
}

/* "Default Title" is Shopify's placeholder on a product with no real options —
   printing it next to the product name reads as a bug to the guest. */
function variantTitle(variant) {
  const title = variant?.title;
  return title && title !== "Default Title" ? title : null;
}

/* featured_image arrives protocol-relative ("//cdn.shopify.com/…"). */
function imageUrl(raw) {
  return raw ? String(raw).replace(/^\/\//, "https://") : null;
}
