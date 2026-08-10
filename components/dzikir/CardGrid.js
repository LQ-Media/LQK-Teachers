import Link from "next/link";
import Icon from "@/components/Icon";

/**
 * The card grid used at every level of the devotional library.
 *
 * Two rules the library depends on:
 *
 * 1. **Nothing is truncated.** Collection titles run from "Ratib" to "Salawat
 *    of Sayyid Ahmad al-'Attas" — an ellipsis in the middle of an Arabic
 *    transliteration is unreadable, so titles wrap to as many lines as they
 *    need.
 * 2. **Every card is the same height.** `grid-auto-rows: 1fr` sizes every row
 *    to the tallest row in the grid (not just the tallest card in its own row),
 *    so a three-line title in the first row does not leave a ragged edge four
 *    rows down. Cards are `h-full` so they fill the row they were given.
 */
export function CardGrid({ children, columns = "sm:grid-cols-2" }) {
  return (
    <div className={`grid gap-2.5 [grid-auto-rows:1fr] ${columns}`}>{children}</div>
  );
}

export function NavCard({ href, icon, image, title, meta }) {
  return (
    <Link
      href={href}
      className="group flex h-full items-center gap-3 rounded-card border border-line bg-white px-4 py-3.5 transition-colors hover:border-gold hover:bg-gold-soft/30"
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          width={40}
          height={40}
          className="h-10 w-10 flex-none rounded-control bg-sand/60 object-contain p-1"
        />
      ) : (
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-control bg-sand/60 text-ink">
          <Icon name={icon} size={16} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        {/* `break-words` rather than `truncate`: the whole title has to be
            readable inside the card (see the grid's contract above). */}
        <span className="block break-words text-[14px] font-semibold leading-snug text-charcoal">
          {title}
        </span>
        {meta ? <span className="mt-0.5 block text-[11.5px] text-charcoal-soft">{meta}</span> : null}
      </span>
      <span className="flex-none self-center text-charcoal-soft/40 transition-transform group-hover:translate-x-0.5">
        <Icon name="chevron-right" size={16} />
      </span>
    </Link>
  );
}
