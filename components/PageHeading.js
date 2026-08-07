import Icon from "@/components/Icon";
import { spotImage } from "@/lib/spot";

/**
 * Standard page title: the page's spot art in a rounded tile, next to the h1
 * and its one-line subtitle. Keeps every portal page header identical.
 *
 * Pass `route` (the page's own path) to get the 3D clay render from
 * lib/spot.js — the pastel ground is baked into the image, so the tile needs
 * no fill of its own. Pages with no render fall back to the line icon on one
 * of the three brand pastels (lavender / rose / peach), keyed by icon so the
 * assignment stays stable without touching call sites. Pass `tone` to
 * override that fallback.
 */
const TONES = {
  lavender: "bg-gold-soft",
  rose: "bg-sage-soft",
  peach: "bg-sand",
};

const ICON_TONE = {
  "clipboard-check": "rose", // tracker, packs, review
  notebook: "lavender", // my reading
  star: "peach", // kalimah
  user: "lavender", // profile
  mic: "rose", // halaqah notebook
  "moon-star": "lavender", // wirid & doa
  users: "peach", // ilmu bank
  trophy: "peach", // achievements
  settings: "lavender", // admin
  compass: "rose", // qibla
  clock: "peach", // work hours
  bell: "peach", // solat & azan
};

export default function PageHeading({ icon, title, subtitle, tone, route }) {
  const spot = spotImage(route);
  const tile = TONES[tone] || TONES[ICON_TONE[icon]] || TONES.lavender;
  return (
    <div className="flex items-center gap-3.5">
      {spot ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={spot}
          alt=""
          width={48}
          height={48}
          className="h-12 w-12 flex-shrink-0 rounded-control object-cover shadow-[0_4px_12px_rgba(64,53,72,0.10)]"
        />
      ) : (
        <span
          className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-control ${tile} text-ink`}
        >
          <Icon name={icon} size={22} />
        </span>
      )}
      <div className="min-w-0">
        <h1 className="font-heading text-2xl font-semibold text-charcoal">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-[13px] text-charcoal-soft">{subtitle}</p> : null}
      </div>
    </div>
  );
}
