import Link from "next/link";

import Icon from "@/components/Icon";
import PageHeading from "@/components/PageHeading";
import { requireSession } from "@/lib/dal";
import { GAMES } from "@/lib/games/catalogue";
import { HURUF } from "@/lib/games/huruf";
import { WORD_CARDS } from "@/lib/games/words";

export const metadata = { title: "Games" };

const TONES = {
  sage: "bg-gold-soft",
  clay: "bg-sage-soft",
  honey: "bg-sand",
};

/**
 * The Games hub.
 *
 * Four touch-screen games built on the LQK huruf flashcards, for handing a
 * tablet to a child. Each one opens as its own full-screen app over the portal
 * so there is nothing for a five-year-old to wander into — see
 * components/games/GameShell.js.
 */
export default async function GamesPage() {
  await requireSession();

  return (
    <div className="px-4 py-6 sm:p-8 max-w-4xl">
      <div className="mb-6">
        <PageHeading
          route="/games"
          icon="sparkles"
          tone="honey"
          title="Games"
          subtitle={`Touch-screen huruf games built from the LQK flashcards — all ${HURUF.length} letters, the three harakat, and the ${WORD_CARDS.length} blending cards.`}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {GAMES.map((g) => (
          <Link
            key={g.slug}
            href={`/games/${g.slug}`}
            className="group flex flex-col rounded-card border border-line bg-white p-4 transition-shadow hover:shadow-[0_6px_20px_rgba(59,55,43,0.10)]"
          >
            <div className="flex items-start gap-3">
              <span
                className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-control ${
                  TONES[g.tone] ?? TONES.sage
                } text-ink`}
              >
                <Icon name={g.icon} size={24} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-heading text-[17px] font-bold leading-tight text-charcoal">
                  {g.title}
                </h2>
                <p className="text-[12px] font-semibold text-gold">{g.tagline}</p>
              </div>
              <Icon name="chevron-right" size={18} />
            </div>

            <p className="mt-2.5 text-[13px] leading-relaxed text-charcoal-soft">{g.blurb}</p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {g.sense.map((s) => (
                <span
                  key={s}
                  className="rounded-pill bg-paper-deep px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-charcoal-soft"
                >
                  {s}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>

      {/* Worth saying once, on the page a teacher opens first: what the games
          do and do not do with a child's work. */}
      <div className="mt-5 rounded-card border border-line bg-paper-deep/60 p-4">
        <h3 className="font-heading text-[14px] font-bold text-charcoal">
          Before you hand over the tablet
        </h3>
        <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-charcoal-soft">
          <li>
            <strong className="text-charcoal">Nothing is recorded.</strong>{" "}
            No child&apos;s work is saved and no progress is tracked — these are teaching aids, not
            assessments.
          </li>
          <li>
            <strong className="text-charcoal">To leave a game,</strong> press and hold the back
            arrow for a moment. A child tapping it cannot get out into the portal.
          </li>
          <li>
            <strong className="text-charcoal">Easy or Proper.</strong> Easy accepts a wide, wobbly
            trace in any direction; Proper insists the letter is started in the right place and
            written right to left.
          </li>
        </ul>
      </div>
    </div>
  );
}
