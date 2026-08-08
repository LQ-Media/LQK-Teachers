import { fontCss, t } from "@/lib/events/design";
import { formatWhen } from "@/lib/events/format";

// The invite itself. One component, three callers: the builder's live preview,
// the public /invite page, and (indirectly) the operator's sense of what a
// parent will see. There is no second "preview" implementation to drift out of
// sync — if it looks right in the builder, that IS the page.
//
// No hooks, so it renders happily inside the Client Component builder and as a
// Server Component on the public page.

function Field({ label, children, muted, align }) {
  if (!children) return null;
  return (
    <div className="mb-4" style={{ textAlign: align }}>
      <div
        className="text-[10px] font-bold uppercase tracking-[0.1em]"
        style={{ color: muted }}
      >
        {label}
      </div>
      <div className="mt-1 text-[15px] leading-relaxed whitespace-pre-line">{children}</div>
    </div>
  );
}

export default function InviteCard({ event, scale = 1, children }) {
  const d = event.design;
  const s = t(event.language);
  const align = d.align;

  const logoUrl = d.showLogo && event.logoPath ? `/api/events/asset/${event.logoPath}` : "";
  const bgUrl = event.backgroundPath ? `/api/events/asset/${event.backgroundPath}` : "";
  const when = formatWhen(event.startsAt, event.endsAt, event.language);
  const venue = [event.venueName, event.venueAddress].filter(Boolean).join("\n");
  const gettingThere = [event.directions, event.parking && `${s.parking}: ${event.parking}`]
    .filter(Boolean)
    .join("\n");

  return (
    <div
      style={{
        background: d.pageColor,
        color: d.textColor,
        fontFamily: fontCss(d.bodyFont),
        // The builder preview shrinks the whole invite rather than reflowing
        // it, so what the operator judges is the real layout at a smaller size.
        ...(scale !== 1 ? { transform: `scale(${scale})`, transformOrigin: "top center" } : null),
      }}
      className="w-full"
    >
      <div
        className="mx-auto w-full max-w-[600px] overflow-hidden"
        style={{ background: d.cardColor, borderRadius: `${d.cornerRadius}px` }}
      >
        {/* Hero. The background image sits behind a scrim whose opacity the
            operator controls — without it, light photos swallow the title. */}
        <div className="relative" style={{ background: bgUrl ? undefined : d.accentColor }}>
          {bgUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={bgUrl} alt="" className="block h-auto w-full object-cover" style={{ maxHeight: 320 }} />
              <div
                className="absolute inset-0"
                style={{ background: d.textColor, opacity: d.overlay / 100 }}
                aria-hidden="true"
              />
            </>
          ) : (
            <div style={{ height: 10 }} />
          )}

          {bgUrl ? (
            <div
              className="absolute inset-0 flex flex-col justify-end p-7"
              style={{ textAlign: align, alignItems: align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start" }}
            >
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="" className="mb-3 h-auto w-[68px] object-contain" />
              ) : null}
              <div
                className="text-[10px] font-bold uppercase tracking-[0.14em]"
                style={{ color: "#fff", opacity: 0.9 }}
              >
                {s.youreInvited}
              </div>
              <h1
                className="mt-1 text-[26px] font-bold leading-tight"
                style={{ fontFamily: fontCss(d.headingFont), color: "#fff" }}
              >
                {event.title}
              </h1>
              {event.tagline ? (
                <p className="mt-1.5 text-[14px]" style={{ color: "#fff", opacity: 0.92 }}>
                  {event.tagline}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Title block, for the no-background case (on a background it lives in
            the hero above, over the image). */}
        {!bgUrl ? (
          <div className="px-8 pt-7" style={{ textAlign: align }}>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt=""
                className="mb-3 h-auto w-[68px] object-contain"
                style={{ marginLeft: align === "center" ? "auto" : 0, marginRight: align === "center" || align === "left" ? "auto" : 0 }}
              />
            ) : null}
            <div className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: d.accentColor }}>
              {s.youreInvited}
            </div>
            <h1 className="mt-1 text-[26px] font-bold leading-tight" style={{ fontFamily: fontCss(d.headingFont) }}>
              {event.title}
            </h1>
            {event.tagline ? (
              <p className="mt-1.5 text-[14px]" style={{ color: d.mutedColor }}>
                {event.tagline}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="px-8 pt-6">
          {event.body ? (
            <p className="mb-6 text-[15px] leading-relaxed whitespace-pre-line" style={{ textAlign: align }}>
              {event.body}
            </p>
          ) : null}

          <Field label={s.when} muted={d.mutedColor} align={align}>{when}</Field>
          <Field label={s.where} muted={d.mutedColor} align={align}>{venue}</Field>

          {event.mapUrl ? (
            <div className="mb-5" style={{ textAlign: align }}>
              <a
                href={event.mapUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block rounded-full px-4 py-2 text-[13px] font-bold no-underline"
                style={{ background: d.accentColor, color: d.buttonTextColor }}
              >
                {s.openInMaps}
              </a>
            </div>
          ) : null}

          {event.agenda?.length ? (
            <div className="mb-5" style={{ textAlign: align }}>
              <div className="text-[10px] font-bold uppercase tracking-[0.1em]" style={{ color: d.mutedColor }}>
                {s.programme}
              </div>
              <table className="mt-2" style={{ marginLeft: align === "center" ? "auto" : 0, marginRight: align === "center" || align === "right" ? "auto" : 0 }}>
                <tbody>
                  {event.agenda.map((a, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap pr-3 pb-1.5 align-top text-[14px] font-bold" style={{ color: d.accentColor }}>
                        {a.time}
                      </td>
                      <td className="pb-1.5 align-top text-left text-[14px]">{a.activity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <Field label={s.dressCode} muted={d.mutedColor} align={align}>{event.dressCode}</Field>
          <Field label={s.whatToBring} muted={d.mutedColor} align={align}>{event.bring}</Field>
          <Field label={s.gettingThere} muted={d.mutedColor} align={align}>{gettingThere}</Field>
        </div>

        {/* RSVP controls (public page) or a stand-in (preview) slot in here. */}
        {children}

        <div className="px-8 pb-8 pt-6" style={{ textAlign: "center" }}>
          {event.contactLine ? (
            <p className="text-[13px]" style={{ color: d.mutedColor }}>
              {event.contactLine}
            </p>
          ) : null}
          {event.hostName ? (
            <p className="mt-1 text-[13px]" style={{ color: d.mutedColor }}>
              {s.hostedBy} {event.hostName}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
