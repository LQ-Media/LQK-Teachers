import Link from "next/link";
import { getGuestByToken, markOpened } from "@/lib/events/queries";
import { themeVars } from "@/lib/events/theme";
import {
  t as translate,
  isLang,
  LANGS,
  DEFAULT_LANG,
  formatDeadline,
} from "@/lib/events/i18n";
import InvitationCard, { InvitationShell } from "@/components/events/InvitationCard";
import RsvpForm from "./RsvpForm";

/* A guest's invitation.

   Rendered per-request (never statically cached) because the page reflects that
   guest's own RSVP state — a cached copy would show one guest another's reply. */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { token } = await params;
  const found = getGuestByToken(token);
  if (!found) return { title: "Invitation" };
  return {
    title: `${found.event.title} — you're invited`,
    description: found.event.venue_name || undefined,
    robots: { index: false, follow: false },
  };
}

function googleCalendarUrl(event) {
  if (!event.starts_at) return null;
  const start = new Date(event.starts_at);
  const end = event.ends_at ? new Date(event.ends_at) : new Date(start.getTime() + 3 * 3600 * 1000);
  const fmt = (d) => d.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${fmt(start)}/${fmt(end)}`,
    details: event.host_name ? `Hosted by ${event.host_name}` : "",
    location: [event.venue_name, event.venue_address].filter(Boolean).join(", "),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

export default async function InvitePage({ params, searchParams }) {
  const { token } = await params;
  const query = await searchParams;
  const found = getGuestByToken(token);

  /* A bad token gets a calm, branded dead end — not a 404 and not a stack
     trace. Guests mistype and chat apps truncate links; this page has to
     explain itself to someone who did nothing wrong. It also says nothing
     about whether the token merely expired or never existed. */
  if (!found || found.event.status === "draft") {
    const t = translate(DEFAULT_LANG);
    return (
      <div className="inv-root" style={themeVars(null)}>
        <div className="inv-card inv-rise" style={{ textAlign: "center" }}>
          <h1 className="inv-title" style={{ fontSize: 24 }}>
            {t("notFound")}
          </h1>
          <p className="inv-note" style={{ marginBottom: 0 }}>
            {t("notFoundBody")}
          </p>
        </div>
      </div>
    );
  }

  const { guest, event, rsvp } = found;

  // Fire-and-forget; never let an analytics write break the render.
  try {
    markOpened(guest.id);
  } catch {}

  // ?lang= wins so the switcher works, then the language we sent them in.
  const lang = isLang(query?.lang) ? query.lang : isLang(guest.lang) ? guest.lang : DEFAULT_LANG;
  const t = translate(lang);

  const theme = event.theme;
  const calUrl = googleCalendarUrl(event);
  const mapUrl =
    event.venue_map_url ||
    (event.venue_address
      ? `https://maps.google.com/?q=${encodeURIComponent(event.venue_address)}`
      : null);

  return (
    /* InvitationShell owns the root element — dir, the --inv-* variables, the
       layout and motion attributes, and the background art. The admin theme
       studio renders through the same component, so a design Karim approves in
       the preview is the design that reaches this page. */
    <InvitationShell theme={theme} lang={lang}>
      <nav className="inv-langbar" aria-label={t("language")}>
        {LANGS.map((l) => (
          <Link
            key={l.code}
            href={`/i/${token}?lang=${l.code}`}
            className="inv-lang"
            aria-current={l.code === lang}
            hrefLang={l.code}
          >
            {l.native}
          </Link>
        ))}
      </nav>

      <InvitationCard event={event} guest={guest} theme={theme} lang={lang}>
        {calUrl || mapUrl ? (
          <div className="inv-actions">
            {calUrl ? (
              <a
                className="inv-btn inv-btn-quiet"
                href={calUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("addToCalendar")}
              </a>
            ) : null}
            {mapUrl ? (
              <a
                className="inv-btn inv-btn-quiet"
                href={mapUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("getDirections")}
              </a>
            ) : null}
          </div>
        ) : null}
      </InvitationCard>

      <RsvpForm token={token} lang={lang} event={event} guest={guest} rsvp={rsvp} />

      {event.support_url ? (
        <aside className="inv-card inv-rise">
          <h2 className="inv-section-title">{t("supportTitle")}</h2>
          <p className="inv-note">{t("supportBody")}</p>
          <div className="inv-actions">
            {/* Cart attribute carries the guest token so a contribution can be
                attributed back to the invitation it came from. Link-out rather
                than an embedded checkout: Shopify's checkout refuses to frame,
                and guests trust their own store's domain more than ours. */}
            <a
              className="inv-btn"
              href={`${event.support_url}${event.support_url.includes("?") ? "&" : "?"}attributes[guest]=${encodeURIComponent(guest.token.slice(0, 8))}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("supportCta")}
            </a>
          </div>
        </aside>
      ) : null}

      <p className="inv-footer">
        {event.rsvp_deadline ? `${t("rsvpBy")} ${formatDeadline(event.rsvp_deadline, lang)} · ` : ""}
        Little Quran Kids
      </p>
    </InvitationShell>
  );
}
