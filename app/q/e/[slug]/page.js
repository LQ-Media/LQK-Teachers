import { notFound } from "next/navigation";
import Link from "next/link";
import { cookies } from "next/headers";
import { getOpenQrEvent, getRegistrationByToken, qrStats } from "@/lib/qr/queries";
import { partyName, PASS_COOKIE } from "@/lib/qr/tokens";
import CheckInForm from "./CheckInForm";

/* The door.

   Rendered per request, never cached: it reflects whether THIS phone already
   holds a pass, and a cached copy would offer one family another's. */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const event = getOpenQrEvent(slug);
  return {
    title: event ? `Check in — ${event.title}` : "Check in",
    robots: { index: false, follow: false },
  };
}

export default async function CheckInPage({ params, searchParams }) {
  const { slug } = await params;
  const query = await searchParams;
  const event = getOpenQrEvent(slug);
  if (!event) notFound();

  /* ?new=1 is the deliberate escape hatch: one phone genuinely does check two
     families in when a grandparent brings the cousins. */
  const startingOver = query?.new === "1";
  const cookieStore = await cookies();
  const existingToken = startingOver ? null : cookieStore.get(`${PASS_COOKIE}_${event.id}`)?.value;
  const existing = existingToken ? getRegistrationByToken(existingToken) : null;
  const alreadyHere =
    existing && existing.registration.qr_event_id === event.id ? existing.registration : null;

  // Whether the door offers a name picker at all. An event with no list still
  // has to work — everyone is simply a walk-in.
  const hasList = qrStats(event.id).expected > 0;

  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg px-5 py-10">
      <header className="text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">Welcome</p>
        <h1 className="mt-2 font-heading text-3xl font-semibold text-charcoal">{event.title}</h1>
        {event.venue_name ? <p className="mt-1 text-sm text-charcoal-soft">{event.venue_name}</p> : null}
      </header>

      {alreadyHere ? (
        <div className="mt-8 rounded-card border border-line bg-sand p-6 text-center">
          <p className="font-heading text-xl font-semibold text-charcoal">You’re already checked in</p>
          <p className="mt-1.5 text-sm text-gold-hover">
            {partyName(alreadyHere)} checked in on this phone.
          </p>
          <Link
            href={`/q/p/${alreadyHere.token}`}
            className="mt-5 inline-block rounded-pill bg-ink px-6 py-3 text-base font-semibold text-white transition-transform duration-150 ease-out active:scale-[0.97]"
          >
            Open our pass
          </Link>
          <p className="mt-4 text-xs text-charcoal-soft">
            Checking in a different family?{" "}
            <Link href={`/q/e/${event.slug}?new=1`} className="text-gold underline">
              Start a new one
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          <p className="mt-6 text-center text-[15px] leading-relaxed text-charcoal-soft">
            {event.intro ||
              (hasList
                ? "Find your child’s name to check your family in."
                : "Tell us who’s here and we’ll check your family in.")}
          </p>
          <CheckInForm event={event} hasList={hasList} />
        </>
      )}
    </main>
  );
}
