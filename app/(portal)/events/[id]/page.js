import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/dal";
import { getEvent, listGuests, eventStats, guestsNeedingReminder } from "@/lib/events/queries";
import { mailConfigured } from "@/lib/events/mail";
import { watiConfigured } from "@/lib/events/wati";
import { driveConfigured } from "@/lib/events/drive";
import { contributionWebhookConfigured } from "@/lib/events/shopify";
import PageHeading from "@/components/PageHeading";
import EventDetail from "./EventDetail";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const event = getEvent(id);
  return { title: `${event?.title || "Event"} · LQK Teachers Portal` };
}

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function Stat({ label, value, hint, href }) {
  const body = (
    <>
      <p className="text-2xl font-semibold tabular-nums text-ink">{value}</p>
      <p className="text-sm text-charcoal-soft">{label}</p>
      {hint ? <p className="mt-0.5 text-xs text-charcoal-soft">{hint}</p> : null}
    </>
  );
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-card border border-line bg-white p-4 transition-colors hover:border-gold"
      >
        {body}
      </a>
    );
  }
  return <div className="rounded-card border border-line bg-white p-4">{body}</div>;
}

export default async function EventPage({ params, searchParams }) {
  await requireRole(["admin"]);
  const { id } = await params;
  const query = await searchParams;

  const event = getEvent(id);
  if (!event) notFound();

  const guests = listGuests(id);
  const stats = eventStats(id);
  // The REAL reminder-eligible count (sent + unreplied + not nudged in 72h) —
  // `pending` alone overstates it and makes the button promise sends that
  // won't happen.
  const reminderCount = guestsNeedingReminder(id).length;

  const baseUrl = (process.env.LQK_PUBLIC_BASE_URL || "https://teachers.littlequrankids.sg").replace(/\/+$/, "");
  const driveFolderUrl = process.env.LQK_DRIVE_FOLDER_ID
    ? `https://drive.google.com/drive/folders/${process.env.LQK_DRIVE_FOLDER_ID}`
    : null;

  return (
    <div className="px-4 py-6 sm:p-8 max-w-4xl">
      <Link href="/events" className="mb-4 inline-block text-sm text-gold hover:underline">
        ← All events
      </Link>

      <PageHeading route="/events" icon="calendar" title={event.title} subtitle={event.venue_name || "Event invitation"} />

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="families invited" value={stats.invited} />
        <Stat label="replied" value={stats.replied} hint={`${stats.pending} still to answer`} />
        <Stat
          label="people attending"
          value={stats.headcount}
          hint={`${plural(stats.adults, "adult")} · ${plural(stats.children, "child", "children")}`}
        />
        <Stat
          label="photos"
          value={stats.photos}
          hint={driveFolderUrl ? "open the Drive folder" : undefined}
          href={driveFolderUrl}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link
          href={`/events/${id}/theme`}
          className="rounded-pill border border-line px-5 py-2.5 text-sm font-semibold text-ink transition-transform duration-150 ease-out active:scale-[0.97]"
        >
          Design studio
        </Link>
        {/* A waiting draft is invisible from the guest side by design, so it
            has to be visible here — otherwise a generated design sits unnoticed
            and Karim assumes the studio didn't work. */}
        {event.themeDraft ? (
          <span className="rounded-control bg-sand px-3 py-1.5 text-sm text-gold-hover">
            A design draft is waiting for approval
          </span>
        ) : null}
      </div>

      <EventDetail
        event={event}
        guests={guests}
        stats={stats}
        reminderCount={reminderCount}
        baseUrl={baseUrl}
        initialTab={typeof query?.tab === "string" ? query.tab : undefined}
        capabilities={{
          mail: mailConfigured(),
          whatsapp: watiConfigured(),
          drive: driveConfigured(),
          shopifyWebhook: contributionWebhookConfigured(),
        }}
      />
    </div>
  );
}
