import { notFound } from "next/navigation";
import Link from "next/link";
import { cookies } from "next/headers";
import { getOpenQrEvent, getFamilyByToken, inviteeStats } from "@/lib/qr/queries";
import { displayName, PASS_COOKIE } from "@/lib/qr/passport";
import RegisterForm from "./RegisterForm";

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

  /* Re-scanning the door QR is the most common accident of the day. If this
     phone already registered, offer the pass back instead of quietly creating
     a second family with a second empty pass — the parent's real intent is
     always "show me my code again".

     ?new=1 is the deliberate escape hatch: one phone genuinely does register
     two families when a grandparent brings the cousins. */
  const startingOver = query?.new === "1";
  const cookieStore = await cookies();
  const existingToken = startingOver ? null : cookieStore.get(`${PASS_COOKIE}_${event.id}`)?.value;
  const existing = existingToken ? getFamilyByToken(existingToken) : null;
  const alreadyHere = existing && existing.family.qr_event_id === event.id ? existing.family : null;

  // Whether the door offers a name picker at all. An open house with no guest
  // list still has to work — everyone is simply a walk-in.
  const hasGuestList = inviteeStats(event.id).total > 0;

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
            {displayName(alreadyHere)} registered on this phone.
          </p>
          <Link
            href={`/q/p/${alreadyHere.token}`}
            className="mt-5 inline-block rounded-pill bg-ink px-6 py-3 text-base font-semibold text-white transition-transform duration-150 ease-out active:scale-[0.97]"
          >
            Open our pass
          </Link>
          <p className="mt-4 text-xs text-charcoal-soft">
            Registering a different family?{" "}
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
              (hasGuestList
                ? "Find your name to get your family pass, then visit every booth to collect a letter."
                : `Register your family to get your pass. Show it at each booth to collect a letter — all ${event.booths.length} of them spell a word.`)}
          </p>
          <RegisterForm event={event} hasGuestList={hasGuestList} />
        </>
      )}
    </main>
  );
}
