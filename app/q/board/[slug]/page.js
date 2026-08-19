import { notFound } from "next/navigation";
import { getPublicQrEvent, leaderboard, qrStats } from "@/lib/events/passport-queries";
import { displayName } from "@/lib/events/passport";
import BoardRefresh from "./BoardRefresh";

/* The leaderboard, for a TV in the hall.

   PUBLIC and PIN-free on purpose: nobody should have to type a password into a
   display that runs unattended all day, and there is nothing here worth
   gating. The query selects the nickname and the surname and nothing else —
   never a child's name, never a phone number. The room is full of strangers.

   Typography is sized for across-the-room, not for a laptop. */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const event = getPublicQrEvent(slug);
  return {
    title: event ? `Leaderboard — ${event.title}` : "Leaderboard",
    robots: { index: false, follow: false },
  };
}

export default async function BoardPage({ params }) {
  const { slug } = await params;
  const event = getPublicQrEvent(slug);
  if (!event) notFound();

  const rows = leaderboard(event.id, 12);
  const stats = qrStats(event.id);
  const total = event.booths.length;

  return (
    <main className="min-h-dvh px-8 py-10">
      <BoardRefresh />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-4xl font-semibold text-charcoal sm:text-5xl">
            {event.title}
          </h1>
          <p className="mt-1 text-lg text-charcoal-soft">
            {stats.families} famil{stats.families === 1 ? "y" : "ies"} ·{" "}
            {stats.finished} finished the word
          </p>
        </div>
        <p className="font-heading text-3xl font-semibold tracking-[0.3em] text-gold sm:text-4xl">
          {event.letters.join(" ")}
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="mt-16 text-center text-2xl text-charcoal-soft">
          The first letter of the day is still to be collected.
        </p>
      ) : (
        <ol className="mt-8 space-y-3">
          {rows.map((row, index) => {
            const done = row.collected >= total;
            return (
              <li
                key={row.id}
                className={`flex items-center gap-3 rounded-card border px-4 py-4 sm:gap-5 sm:px-6 ${
                  done ? "border-gold bg-sand" : "border-line bg-white"
                }`}
              >
                <span className="w-8 flex-shrink-0 font-heading text-2xl font-semibold tabular-nums text-charcoal-soft sm:w-10 sm:text-3xl">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-heading text-2xl font-semibold text-charcoal sm:text-3xl">
                  {displayName(row)}
                </span>
                {/* The dot strip is a nicety; the NAME is the point. Below sm
                    they compete for the same row and the name loses — it
                    collapsed to zero width and the board read as anonymous
                    numbers. Someone always opens the board on a phone to check
                    it before the TV goes up. */}
                <span className="hidden flex-shrink-0 gap-1.5 sm:flex" aria-hidden="true">
                  {Array.from({ length: total }, (_, i) => (
                    <span
                      key={i}
                      className={`h-4 w-4 rounded-pill ${
                        i < row.collected ? "bg-gold" : "bg-paper-deep"
                      }`}
                    />
                  ))}
                </span>
                <span className="w-20 flex-shrink-0 text-right font-heading text-2xl font-semibold tabular-nums text-ink sm:w-24 sm:text-3xl">
                  {row.collected}
                  <span className="text-xl text-charcoal-soft">/{total}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
