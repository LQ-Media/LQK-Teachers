import Link from "next/link";
import { requireRole } from "@/lib/dal";
import { listStoreOrders } from "@/lib/events/queries";
import PageHeading from "@/components/PageHeading";

export const metadata = { title: "Store registrations · LQK Teachers Portal" };
export const dynamic = "force-dynamic";

/* Attendee registrations sold on the LQK store's product pages (LQK Maulid
   2026): one card per paid order, one block per place, fed by the orders/paid
   webhook. Read-only on purpose — the order is Shopify's record; this page is
   the registration desk's view of it. */

function money(order) {
  if (!order.amount) return null;
  return `${order.currency || "SGD"} ${order.amount}`;
}

function paidOn(order) {
  if (!order.paid_at) return null;
  const d = new Date(order.paid_at);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-SG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Singapore",
  });
}

export default async function RegistrationsPage() {
  await requireRole(["admin"]);
  const orders = listStoreOrders();
  const places = orders.reduce((sum, o) => sum + (o.attendees.length || o.qty || 0), 0);

  return (
    <div className="px-4 py-6 sm:p-8 max-w-4xl">
      <PageHeading
        route="/events"
        icon="calendar"
        title="Store registrations"
        subtitle="Attendees from ticketed products on the LQK store, straight off each paid order."
      />

      <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-charcoal-soft">
        <span>
          <strong className="text-ink">{orders.length}</strong> paid {orders.length === 1 ? "order" : "orders"}
        </span>
        <span>
          <strong className="text-ink">{places}</strong> {places === 1 ? "place" : "places"}
        </span>
        {orders.length > 0 ? (
          <a href="/api/events/registrations/csv" className="ms-auto text-gold hover:underline">
            Download attendee list (CSV)
          </a>
        ) : null}
      </p>

      {orders.length === 0 ? (
        <div className="mt-6 rounded-card border border-line bg-white p-6 text-sm text-charcoal-soft">
          <p>
            Nothing yet. Registrations appear here the moment the store confirms payment on an
            order whose product page asks for attendee details (LQK Maulid 2026).
          </p>
          <p className="mt-2">
            If orders are being paid but nothing lands here, check that the store's{" "}
            <em>Order payment</em> webhook and <code>SHOPIFY_EVENTS_WEBHOOK_SECRET</code> are set up —
            the same wiring that confirms invitation contributions.
          </p>
        </div>
      ) : (
        <ul className="mt-6 grid gap-3">
          {orders.map((order) => (
            <li key={order.order_id} className="rounded-card border border-line bg-white p-5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="font-heading text-lg text-ink">
                  {order.order_number ? `Order #${order.order_number}` : `Order ${order.order_id}`}
                </h2>
                {money(order) ? (
                  <span className="text-sm font-semibold text-ink">{money(order)}</span>
                ) : null}
                {paidOn(order) ? (
                  <span className="ms-auto text-sm text-charcoal-soft">{paidOn(order)}</span>
                ) : null}
              </div>
              <p className="mt-0.5 text-sm text-charcoal-soft">
                {order.line_title}
                {order.qty ? ` · ${order.qty} ${order.qty === 1 ? "place" : "places"}` : ""}
                {order.customer_name || order.customer_email
                  ? ` · booked by ${order.customer_name || order.customer_email}`
                  : ""}
              </p>
              {order.event_title ? (
                <p className="mt-0.5 text-xs text-charcoal-soft">
                  Came through an invitation:{" "}
                  <Link href={`/events/${order.event_id}`} className="text-gold hover:underline">
                    {order.event_title}
                  </Link>
                </p>
              ) : null}

              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {order.attendees.map((a, i) => (
                  <li key={i} className="rounded-card bg-paper-deep p-3 text-sm">
                    <p className="text-[10px] font-extrabold uppercase tracking-widest text-charcoal-soft">
                      {a.main || i === 0 ? "Main attendee" : `Attendee ${i + 1}`}
                    </p>
                    <p className="mt-1 font-semibold text-ink">{a.name || "—"}</p>
                    {a.email ? <p className="text-charcoal-soft">{a.email}</p> : null}
                    {a.phone ? <p className="text-charcoal-soft">{a.phone}</p> : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
