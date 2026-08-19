import Link from "next/link";
import { requireRole } from "@/lib/dal";
import { listQrEvents } from "@/lib/qr/queries";
import PageHeading from "@/components/PageHeading";
import NewQrEventForm from "./NewQrEventForm";

export const metadata = { title: "QR Registration · LQK Teachers Portal" };
export const dynamic = "force-dynamic";

const STATUS_TONE = {
  open: "bg-gold-soft text-ink",
  draft: "bg-paper-deep text-charcoal-soft",
  closed: "bg-paper-deep text-charcoal-soft",
};

const STATUS_LABEL = { open: "Checking in", draft: "Draft", closed: "Closed" };

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" });
}

export default async function QrIndexPage() {
  await requireRole(["admin"]);
  const events = listQrEvents();

  return (
    <div className="max-w-4xl px-4 py-6 sm:p-8">
      <PageHeading
        route="/qr"
        icon="grid"
        title="QR Registration"
        subtitle="Families scan in at the door, then collect letters around the hall"
      />

      <NewQrEventForm />

      {events.length === 0 ? (
        <p className="mt-8 rounded-card border border-line bg-white p-6 text-sm text-charcoal-soft">
          Nothing set up yet. Create one for an open house, a fun day, or any event where
          families walk in — it doesn’t need an invitation list to exist.
        </p>
      ) : (
        <ul className="mt-8 space-y-3">
          {events.map((event) => {
            const date = formatDate(event.starts_at);
            return (
              <li key={event.id}>
                <Link
                  href={`/qr/${event.id}`}
                  className="block rounded-card border border-line bg-white p-5 transition-colors duration-150 hover:border-gold"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="font-heading text-lg font-semibold text-charcoal">
                      {event.title}
                    </span>
                    <span
                      className={`rounded-pill px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-widest ${
                        STATUS_TONE[event.status]
                      }`}
                    >
                      {STATUS_LABEL[event.status]}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-charcoal-soft">
                    {[event.venue_name, date].filter(Boolean).join(" · ") || "No venue or date yet"}
                  </p>
                  <p className="mt-2 text-sm text-charcoal-soft">
                    {event.booth_count} booth{event.booth_count === 1 ? "" : "s"} ·{" "}
                    {event.family_count} checked in
                    {event.invitee_count ? ` of ${event.invitee_count} expected` : ""}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
