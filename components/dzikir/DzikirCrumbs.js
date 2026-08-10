import Link from "next/link";
import Icon from "@/components/Icon";

/**
 * The trail through the devotional library: Wirid & Doa → group → collection →
 * sub-section → passage.
 *
 * Every level except the last is a link, so a teacher four screens deep can
 * step back to any ancestor in one tap rather than hitting Back repeatedly.
 * It scrolls sideways instead of wrapping — on a phone the full trail is wider
 * than the screen, and a wrapped trail pushes the content down a line at a
 * depth that changes from page to page.
 *
 * `items` is [{ label, href }]; the final item is rendered as plain text
 * whether or not it carries an href.
 */
export default function DzikirCrumbs({ items }) {
  const trail = items.filter(Boolean);
  if (!trail.length) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="-mx-4 mb-4 overflow-x-auto px-4 [-ms-overflow-style:none] [scrollbar-width:none] sm:-mx-8 sm:px-8 [&::-webkit-scrollbar]:hidden"
    >
      <ol className="flex w-max items-center gap-1 text-[12.5px]">
        {trail.map((item, i) => {
          const last = i === trail.length - 1;
          return (
            <li key={`${item.href || "current"}-${i}`} className="flex items-center gap-1">
              {i > 0 && (
                <span className="flex-none text-charcoal-soft/40" aria-hidden="true">
                  <Icon name="chevron-right" size={13} />
                </span>
              )}
              {last || !item.href ? (
                <span className="whitespace-nowrap font-semibold text-charcoal" aria-current="page">
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="whitespace-nowrap rounded-control px-1.5 py-1 text-charcoal-soft transition-colors hover:bg-gold-soft/40 hover:text-charcoal"
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
