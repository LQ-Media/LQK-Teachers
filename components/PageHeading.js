import Icon from "@/components/Icon";

/**
 * Standard page title: the page's sidebar icon in a gold tile, next to the
 * h1 and its one-line subtitle. Keeps every portal page header identical.
 */
export default function PageHeading({ icon, title, subtitle }) {
  return (
    <div className="flex items-center gap-3.5">
      <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-control bg-gold-soft text-ink">
        <Icon name={icon} size={22} />
      </span>
      <div className="min-w-0">
        <h1 className="font-heading text-2xl font-semibold text-charcoal">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-[13px] text-charcoal-soft">{subtitle}</p> : null}
      </div>
    </div>
  );
}
