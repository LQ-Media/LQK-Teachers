import { notFound } from "next/navigation";
import { requireRole } from "@/lib/dal";
import { getQrEvent } from "@/lib/events/passport-queries";
import QrCode from "@/components/events/QrCode";
import PrintButton from "./PrintButton";

/* The door poster.

   Staff-only and inside the portal even though what it prints is public: it is
   printed by Karim, not read by a parent, and the public namespace should hold
   only the five things families and volunteers actually open.

   PRINT IT AFTER DEPLOYING. The QR encodes LQK_PUBLIC_BASE_URL, so a poster
   printed from a laptop dev server encodes localhost and is a blank wall at the
   event. */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const event = getQrEvent(id);
  return { title: `Poster · ${event?.title || "Event"}` };
}

export default async function PosterPage({ params }) {
  await requireRole(["admin"]);
  const { id } = await params;
  const event = getQrEvent(id);
  if (!event) notFound();

  const baseUrl = (process.env.LQK_PUBLIC_BASE_URL || "https://teachers.littlequrankids.sg").replace(/\/+$/, "");
  const url = `${baseUrl}/q/e/${event.slug}`;
  const isLocal = /localhost|127\.0\.0\.1/.test(baseUrl);

  return (
    <div className="px-4 py-6 sm:p-8">
      <div className="mx-auto max-w-2xl print:hidden">
        {isLocal ? (
          <p className="mb-4 rounded-control bg-rust-soft px-4 py-3 text-sm text-rust">
            This QR points at <strong>{baseUrl}</strong>, which only exists on this laptop. Set
            LQK_PUBLIC_BASE_URL and reload before printing, or the poster is a blank wall.
          </p>
        ) : null}
        <PrintButton />
      </div>

      {/* One page, centred, no portal chrome when printed. */}
      <article className="mx-auto mt-6 max-w-2xl rounded-card border border-line bg-white p-10 text-center print:mt-0 print:border-0 print:p-0">
        <p className="font-heading text-lg font-semibold uppercase tracking-[0.3em] text-gold">
          Welcome to
        </p>
        <h1 className="mt-3 font-heading text-5xl font-semibold leading-tight text-charcoal">
          {event.title}
        </h1>

        <p className="mx-auto mt-6 max-w-md text-xl leading-relaxed text-charcoal-soft">
          Scan to register your family and start collecting letters around the hall.
        </p>

        <div className="mt-8 flex justify-center">
          {/* Big. A poster QR is read from two metres away by a phone held at
              an angle, and every millimetre of module size is range. */}
          <QrCode value={url} size={340} title={`Check in to ${event.title}`} />
        </div>

        <p className="mt-6 text-base text-charcoal-soft">{url}</p>

        {event.booths.length ? (
          <>
            <p className="mt-10 font-heading text-2xl font-semibold text-charcoal">
              Visit all {event.booths.length} booths to spell
            </p>
            <p className="mt-3 font-heading text-5xl font-semibold tracking-[0.25em] text-gold">
              {event.letters.join(" ")}
            </p>
          </>
        ) : null}
      </article>
    </div>
  );
}
