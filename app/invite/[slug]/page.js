import { getEventBySlug, getRecipientByToken } from "@/lib/events/store";
import { t } from "@/lib/events/design";
import { formatWhen } from "@/lib/events/format";
import InviteCard from "@/components/events/InviteCard";
import RsvpPanel from "@/components/events/RsvpPanel";

// The one page in this app a parent sees. It sits outside the (portal) group
// and outside the auth gate (see proxy.js) — a parent has no login, and an
// invitation behind a password is not an invitation.

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const event = getEventBySlug(slug);
  if (!event) return { title: "Invitation" };

  const when = formatWhen(event.startsAt, event.endsAt, event.language);
  const description = event.tagline || [when, event.venueName].filter(Boolean).join(" · ");

  return {
    title: `${event.title} · Little Quran Kids`,
    description,
    // WhatsApp and iMessage render this card under the link. Worth getting
    // right: it is the first thing a parent sees, before they tap.
    openGraph: {
      title: event.title,
      description,
      type: "website",
      images: event.backgroundPath ? [{ url: `/api/events/asset/${event.backgroundPath}` }] : undefined,
    },
    robots: { index: false, follow: false },
  };
}

export default async function InvitePage({ params, searchParams }) {
  const { slug } = await params;
  const { r: token } = await searchParams;

  const event = getEventBySlug(slug);
  const s = t(event?.language || "en");

  if (!event) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-paper px-6">
        <div className="text-center">
          <h1 className="font-heading text-xl font-semibold text-charcoal">{s.linkExpired}</h1>
          <p className="mt-2 text-[14px] text-charcoal-soft">{s.linkExpiredBody}</p>
        </div>
      </main>
    );
  }

  // A token that doesn't match this event is treated as no token at all: the
  // invite still renders, but there is nothing to record an RSVP against.
  const recipient = token ? getRecipientByToken(String(token)) : null;
  const valid = recipient && recipient.eventId === event.id ? recipient : null;

  return (
    <main className="min-h-screen py-8 px-3" style={{ background: event.design.pageColor }}>
      <InviteCard event={event}>
        <RsvpPanel
          token={valid?.token || ""}
          language={event.language}
          design={event.design}
          initialRsvp={valid?.rsvp || null}
        />
      </InviteCard>
    </main>
  );
}
