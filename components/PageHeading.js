import Icon from "@/components/Icon";

/**
 * Standard page title: the page's sidebar icon in a pastel tile, next to the
 * h1 and its one-line subtitle. Keeps every portal page header identical.
 *
 * Each page gets one of the three brand pastels (lavender / rose / peach),
 * keyed by its icon so the assignment stays stable across the app without
 * touching call sites. Pass `tone` to override.
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
};

export default function PageHeading({ icon, title, subtitle, tone }) {
  const tile = TONES[tone] || TONES[ICON_TONE[icon]] || TONES.lavender;
  return (
    <div className="flex items-center gap-3.5">
      <span className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-control ${tile} text-ink`}>
        <Icon name={icon} size={22} />
      </span>
      <div className="min-w-0">
        <h1 className="font-heading text-2xl font-semibold text-charcoal">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-[13px] text-charcoal-soft">{subtitle}</p> : null}
      </div>
    </div>
  );
}
