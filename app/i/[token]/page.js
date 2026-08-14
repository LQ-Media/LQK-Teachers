import Link from "next/link";
import { getGuestByToken, markOpened, isEventClosed } from "@/lib/events/queries";
import { getContributionProduct } from "@/lib/events/shopify";
import { themeVars } from "@/lib/events/theme";
import {
  t as translate,
  isLang,
  LANGS,
  DEFAULT_LANG,
  fmt,
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
    title: `${found.event.title} — an invitation for your family`,
    description: found.event.venue_name || undefined,
    robots: { index: false, follow: false },
  };
}

function googleCalendarUrl(event) {
  if (!event.starts_at) return null;
  const start = new Date(event.starts_at);
  const end = event.ends_at ? new Date(event.ends_at) : new Date(start.getTime() + 3 * 3600 * 1000);
  const fmtDate = (d) => d.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${fmtDate(start)}/${fmtDate(end)}`,
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
     explain itself to someone who did nothing wrong, in the language they were
     sent (?lang= survives even when the token doesn't resolve). It also says
     nothing about whether the token merely expired or never existed. */
  if (!found || found.event.status === "draft") {
    const lang = isLang(query?.lang) ? query.lang : DEFAULT_LANG;
    const t = translate(lang);
    return (
      <div className="inv-root" style={themeVars(null)} lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
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
  const closed = isEventClosed(event);

  /* .ics first (this audience is iPhone-heavy and Apple Calendar opens a
     downloaded file with no sign-in); the Google URL only when there is no
     date to build a file from — it degrades to a template chooser. */
  const calUrl = event.starts_at ? `/api/i/${token}/ics` : googleCalendarUrl(event);
  const mapUrl =
    event.venue_map_url ||
    (event.venue_address
      ? `https://maps.google.com/?q=${encodeURIComponent(event.venue_address)}`
      : null);

  // Live details for the compulsory contribution, from the store's public
  // storefront JSON. null when the event has no product configured (or the
  // store is unreachable and nothing is cached) — the form degrades to a
  // plain reply rather than blocking families on a fetch.
  const contribution =
    event.ask_contribution && event.support_url
      ? await getContributionProduct(event.support_url)
      : null;

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
              <a className="inv-btn inv-btn-quiet" href={calUrl}>
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

      {closed ? (
        /* The gate lives HERE, on the server — never as a post-submit surprise.
           The invitation card above stays: a closed majlis is still worth
           finding on a calendar or a map. */
        <div className="inv-card inv-rise inv-rsvp-block" style={{ textAlign: "center" }}>
          <p className="inv-status">{t("closed")}</p>
          <p className="inv-note" style={{ marginBottom: 0 }}>
            {t("closedBody")}
          </p>
        </div>
      ) : (
        <RsvpForm
          token={token}
          lang={lang}
          event={event}
          guest={guest}
          rsvp={rsvp}
          contribution={contribution}
          calUrl={calUrl}
          mapUrl={mapUrl}
        />
      )}

      {/* The one link on this page that ISN'T a credential. Everything else here
          is scoped to this family's token; this is the open door Karim can drop
          into a group chat, so it says so plainly rather than sitting next to
          the personal actions and being mistaken for one. */}
      {event.registration_url ? (
        <div className="inv-card inv-rise inv-register">
          <h2 className="inv-section-title">{t("registerTitle")}</h2>
          <p className="inv-note">{t("registerBody")}</p>
          <a
            className="inv-btn inv-btn-quiet"
            href={event.registration_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("registerCta")} ↗
          </a>
        </div>
      ) : null}

      <p className="inv-footer">
        {event.rsvp_deadline
          ? `${fmt(t("replyBy"), { date: formatDeadline(event.rsvp_deadline, lang) })} · `
          : ""}
        Little Quran Kids
      </p>
    </InvitationShell>
  );
}
