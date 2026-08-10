import Icon from "@/components/Icon";
import { spotImage } from "@/lib/spot";

/**
 * Standard page title: the page's spot art in a rounded tile, next to the h1
 * and its one-line subtitle. Keeps every portal page header identical.
 *
 * Pass `route` (the page's own path) to get the 3D clay render from
 * lib/spot.js. The render is a transparent cut-out, so the tone tile behind it
 * is what colours the tile — that used to be baked into the image, which meant
 * the art could only ever sit on one background. Pages with no render fall
 * back to the line icon on the same tile. Pass `tone` to override the
 * automatic assignment.
 */
const TONES = {
  sage: "bg-gold-soft",
  clay: "bg-sage-soft",
  honey: "bg-sand",
};

// Which of the three natural tones a page wears, keyed by its icon so the
// assignment stays stable without touching call sites.
const ICON_TONE = {
  "clipboard-check": "clay", // tracker, packs, review
  notebook: "sage", // my reading
  star: "honey", // kalimah
  user: "sage", // profile
  mic: "clay", // halaqah notebook
  "moon-star": "sage", // wirid & doa
  users: "honey", // ilmu bank
  trophy: "honey", // achievements
  settings: "sage", // admin
  compass: "clay", // qibla
  clock: "honey", // work hours
  bell: "honey", // solat & azan
};

export default function PageHeading({ icon, title, subtitle, tone, route }) {
  const spot = spotImage(route);
  const tile = TONES[tone] || TONES[ICON_TONE[icon]] || TONES.sage;
  return (
    <div className="flex items-center gap-3.5">
      <span
        className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-control ${tile} text-ink shadow-[0_4px_12px_rgba(59,55,43,0.10)]`}
      >
        {spot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={spot} alt="" width={40} height={40} className="h-10 w-10 object-contain" />
        ) : (
          <Icon name={icon} size={22} />
        )}
      </span>
      <div className="min-w-0">
        <h1 className="font-heading text-2xl font-semibold text-charcoal">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-[13px] text-charcoal-soft">{subtitle}</p> : null}
      </div>
    </div>
  );
}
