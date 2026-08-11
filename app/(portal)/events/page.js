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
      ? "bg-sand text-gold-hover"
      : status === "closed"
        ? "bg-paper-deep text-charcoal-soft"
        : "bg-paper-deep text-charcoal-soft";
  return (
    <span className={`rounded-pill px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-widest ${tone}`}>
      {status}
    </span>
  );
}

/* Days until replies close, for the row's right edge. Only a LIVE event with a
   future deadline warns — a draft's deadline is a plan, a closed event's is
   history. */
function deadlineWarning(event) {
  if (event.status !== "live" || !event.rsvp_deadline) return null;
  const end = new Date(`${event.rsvp_deadline}T23:59:59+08:00`).getTime();
  const days = Math.ceil((end - Date.now()) / 86400000);
  if (days < 0) return null;
  if (days === 0) return "Replies close today";
  return `Replies close in ${days} day${days === 1 ? "" : "s"}`;
}

/* The reply-progress bar: attending · awaiting payment · declined, as shares
   of everyone invited. Real counts only — an empty guest list draws an empty
   track rather than inventing a denominator. */
function ProgressBar({ event }) {
  const total = event.guest_count || 0;
  if (!total) return null;
  const paid = event.paid_count || 0;
  // Awaiting payment only exists as a state when a contribution is configured.
  const awaiting = event.support_url ? Math.max(0, (event.yes_count || 0) - paid) : 0;
  const attending = (event.yes_count || 0) - awaiting;
  const declined = event.no_count || 0;
  const pct = (n) => `${(n / total) * 100}%`;
  return (
    <div
      className="mt-3 flex h-2 w-full overflow-hidden rounded-pill bg-paper-deep"
      role="img"
      aria-label={`${attending} attending, ${awaiting} awaiting payment, ${declined} declined, of ${total} invited`}
    >
      <span style={{ width: pct(attending) }} className="bg-gold" />
      <span style={{ width: pct(awaiting) }} className="bg-[#E3C88A]" />
      <span style={{ width: pct(declined) }} className="bg-[#DFA893]" />
    </div>
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
          {events.map((e) => {
            const warning = deadlineWarning(e);
            return (
              <li key={e.id}>
                <Link
                  href={`/events/${e.id}`}
                  className={`block rounded-card border border-line bg-white p-5 transition-colors hover:border-gold focus-visible:outline-2 focus-visible:outline-gold ${
                    e.status === "draft" ? "opacity-70" : ""
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h2 className="font-heading text-xl text-ink">{e.title}</h2>
                    <StatusPill status={e.status} />
                    {warning ? (
                      <span className="ms-auto text-sm font-semibold text-rust">{warning}</span>
                    ) : null}
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

                  <ProgressBar event={e} />

                  {/* Counts carry their units — "64 · 43 · 137" answers nothing. */}
                  <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-charcoal-soft">
                    <span>
                      <strong className="text-ink">{e.guest_count}</strong> families invited
                    </span>
                    <span>
                      <strong className="text-ink">{e.reply_count}</strong> replied
                    </span>
                    <span>
                      <strong className="text-ink">{e.head_count}</strong> people attending
                    </span>
                    {e.support_url ? (
                      <span>
                        <strong className="text-ink">{e.paid_count}</strong> hampers paid
                      </span>
                    ) : null}
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
