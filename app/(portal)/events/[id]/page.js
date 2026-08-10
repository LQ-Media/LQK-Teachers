import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/dal";
import { getEvent, listGuests, eventStats } from "@/lib/events/queries";
import { mailConfigured } from "@/lib/events/mail";
import { watiConfigured } from "@/lib/events/wati";
import { driveConfigured } from "@/lib/events/drive";
import PageHeading from "@/components/PageHeading";
import EventDetail from "./EventDetail";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const event = getEvent(id);
  return { title: `${event?.title || "Event"} · LQK Teachers Portal` };
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-card border border-line bg-white p-4">
      <p className="text-2xl font-semibold tabular-nums text-ink">{value}</p>
      <p className="text-sm text-charcoal-soft">{label}</p>
      {hint ? <p className="mt-0.5 text-xs text-charcoal-soft">{hint}</p> : null}
    </div>
  );
}

export default async function EventPage({ params }) {
  await requireRole(["admin"]);
  const { id } = await params;

  const event = getEvent(id);
  if (!event) notFound();

  const guests = listGuests(id);
  const stats = eventStats(id);

  const baseUrl = (process.env.LQK_PUBLIC_BASE_URL || "https://teachers.littlequrankids.sg").replace(/\/+$/, "");

  return (
    <div className="px-4 py-6 sm:p-8 max-w-4xl">
      <Link href="/events" className="mb-4 inline-block text-sm text-gold hover:underline">
        ← All events
      </Link>

      <PageHeading route="/events" icon="calendar" title={event.title} subtitle={event.venue_name || "Event invitation"} />

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Invited" value={stats.invited} />
        <Stat label="Replied" value={stats.replied} hint={`${stats.pending} still to answer`} />
        <Stat label="Attending" value={stats.headcount} hint={`${stats.adults} adults · ${stats.children} children`} />
        <Stat label="Photos" value={stats.photos} />
      </div>

      <EventDetail
        event={event}
        guests={guests}
        stats={stats}
        baseUrl={baseUrl}
        capabilities={{
          mail: mailConfigured(),
          whatsapp: watiConfigured(),
          drive: driveConfigured(),
        }}
      />
    </div>
  );
}
