import Link from "next/link";
import { requireRole } from "@/lib/dal";
import { listEvents } from "@/lib/events/queries";
import PageHeading from "@/components/PageHeading";
import NewEventForm from "./NewEventForm";

export const metadata = { title: "Events · LQK Teachers Portal" };
export const dynamic = "force-dynamic";

function StatusPill({ status }) {
  const tone =
    status === "live"
      ? "bg-gold-soft text-ink"
      : status === "closed"
        ? "bg-paper-deep text-charcoal-soft"
        : "bg-sand text-sage";
  return (
    <span className={`rounded-pill px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tone}`}>
      {status}
    </span>
  );
}

export default async function EventsPage() {
  await requireRole(["admin"]);
  const events = listEvents();

  return (
    <div className="px-4 py-6 sm:p-8 max-w-4xl">
      <PageHeading
        route="/events"
        icon="calendar"
        title="Event invitations"
        subtitle="Create an invitation, send it by email and WhatsApp, and watch the replies land."
      />

      <NewEventForm />

      {events.length === 0 ? (
        <p className="mt-8 rounded-card border border-line bg-white p-6 text-sm text-charcoal-soft">
          No events yet. Create one above — you can change every detail before anything is sent.
        </p>
      ) : (
        <ul className="mt-8 grid gap-3">
          {events.map((e) => (
            <li key={e.id}>
              <Link
                href={`/events/${e.id}`}
                className="block rounded-card border border-line bg-white p-5 transition-colors hover:border-gold focus-visible:outline-2 focus-visible:outline-gold"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h2 className="font-heading text-lg text-ink">{e.title}</h2>
                  <StatusPill status={e.status} />
                </div>
                {e.starts_at ? (
                  <p className="mt-0.5 text-sm text-charcoal-soft">
                    {new Date(e.starts_at).toLocaleString("en-SG", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Asia/Singapore",
                    })}
                    {e.venue_name ? ` · ${e.venue_name}` : ""}
                  </p>
                ) : null}
                <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-charcoal-soft">
                  <span>
                    <strong className="text-ink">{e.guest_count}</strong> invited
                  </span>
                  <span>
                    <strong className="text-ink">{e.reply_count}</strong> replied
                  </span>
                  <span>
                    <strong className="text-ink">{e.head_count}</strong> attending
                  </span>
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
