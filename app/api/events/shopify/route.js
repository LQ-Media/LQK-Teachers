import { verifyShopifyHmac, orderInviteRef } from "@/lib/events/shopify-core";
import { applyContributionPayment } from "@/lib/events/queries";

/* Shopify "Order payment" webhook from the LQK store
   (lqkstore.littlequrankids.sg).

   HOW THIS GETS WIRED UP (there is no Admin API for this store, so the
   subscription is created by hand, exactly like the Parents portal's):
     Store admin → Settings → Notifications → Webhooks → Create webhook
       Event: Order payment · Format: JSON · API version: latest
       URL:   https://teachers.littlequrankids.sg/api/events/shopify
     Then copy the signing secret shown on that settings page into the
     SHOPIFY_EVENTS_WEBHOOK_SECRET env var on Railway.

   Only orders that travelled through an invitation's "Contribute & continue"
   button carry our two cart attributes (invite = 8-char token prefix,
   event = event id); everything else the store sells lands here too and is
   deliberately answered 200/skipped — a non-2xx would make Shopify retry for
   days and eventually flag the webhook as broken.

   ⚠️ Never enable Shopify's "Send test notification" reasoning against this
   endpoint being idempotent — it is (kv-keyed by order id), but the dummy
   payload carries no attributes and simply lands in the skipped bucket. */

export async function POST(request) {
  const secret = process.env.SHOPIFY_EVENTS_WEBHOOK_SECRET;
  if (!secret) {
    // Misconfiguration is OUR fault; 503 keeps Shopify retrying until the env
    // var lands rather than silently dropping real payments.
    return Response.json({ error: "webhook secret not configured" }, { status: 503 });
  }

  // The raw bytes, before any parse — the HMAC is over exactly what was sent.
  const raw = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256");
  if (!verifyShopifyHmac(raw, hmac, secret)) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  let order;
  try {
    order = JSON.parse(raw);
  } catch {
    return Response.json({ ok: true, skipped: "unparseable" });
  }

  const topic = request.headers.get("x-shopify-topic") || "";
  // "Order payment" arrives as orders/paid. Anything else subscribed by
  // accident is acknowledged and ignored.
  if (topic && topic !== "orders/paid") return Response.json({ ok: true, skipped: topic });

  const ref = orderInviteRef(order);
  if (!ref) return Response.json({ ok: true, skipped: "no invite attributes" });

  const line = Array.isArray(order.line_items) ? order.line_items[0] : null;
  const result = applyContributionPayment({
    eventId: ref.eventId,
    tokenPrefix: ref.tokenPrefix,
    orderId: order.id,
    lineTitle: line
      ? [line.title, line.variant_title && line.variant_title !== "Default Title" ? line.variant_title : null]
          .filter(Boolean)
          .join(" — ")
      : null,
    qty: line?.quantity,
    amount: order.current_total_price || order.total_price || null,
    paidAt: order.processed_at || order.created_at || null,
  });

  // A guest we can't match is logged for the admin to reconcile by order id,
  // but still 200 — retrying will never make an unknown prefix match.
  if (!result.ok) {
    console.warn(`[events/shopify] order ${order.id}: ${result.error}`);
    return Response.json({ ok: true, skipped: result.error });
  }
  return Response.json({ ok: true, duplicate: !!result.duplicate });
}
