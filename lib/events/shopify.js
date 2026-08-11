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

  const variant = pickVariant(data, parsed.variantId);
  if (!variant) return null;

  // featured_image arrives protocol-relative ("//cdn.shopify.com/…").
  const rawImage = variant.featured_image?.src || data.featured_image || null;
  const image = rawImage ? String(rawImage).replace(/^\/\//, "https://") : null;

  return {
    handle: parsed.handle,
    title: data.title || parsed.handle,
    variantId: String(variant.id),
    variantTitle: variant.title && variant.title !== "Default Title" ? variant.title : null,
    priceCents: Number(variant.price) || 0,
    priceText: formatPrice(variant.price),
    available: variant.available !== false,
    image,
    url: `${storeOrigin()}/products/${parsed.handle}`,
  };
}

/* On a fetch failure, an expired cache entry beats showing the guest nothing —
   the price on the card is informational; checkout charges the truth. */
function stale(parsed) {
  const hit = cache.get(parsed.handle);
  if (!hit) return null;
  const variant = pickVariant(hit.data, parsed.variantId);
  if (!variant) return null;
  const rawImage = variant.featured_image?.src || hit.data.featured_image || null;
  return {
    handle: parsed.handle,
    title: hit.data.title || parsed.handle,
    variantId: String(variant.id),
    variantTitle: variant.title && variant.title !== "Default Title" ? variant.title : null,
    priceCents: Number(variant.price) || 0,
    priceText: formatPrice(variant.price),
    available: variant.available !== false,
    image: rawImage ? String(rawImage).replace(/^\/\//, "https://") : null,
    url: `${storeOrigin()}/products/${parsed.handle}`,
  };
}
