import { themeVars, sanitizeTheme } from "@/lib/events/theme";
import { t as translate, dirFor, formatEventDate } from "@/lib/events/i18n";
import { bodyParagraphs } from "@/lib/events/fields";
import Ornament from "./Ornament";

/* The invitation itself, factored out so ONE renderer serves two callers:

   - app/i/[token]/page.js, what a guest opens
   - the admin theme studio's live preview

   That shared-ness is the whole point. Karim approves a design and sends it to
   200 people in one action; if the preview drew the invitation with its own
   markup, "approved" would mean "approved something similar". Every layout,
   ornament and colour below is therefore reached through the same code path
   from both sides.

   Client-safe — no db, no server-only imports — because the studio preview is a
   client component that re-renders on every slider drag.

   LAYOUT lives here and in invitation.css together. The component contributes
   only what CSS cannot: the hero image element for photo-hero, and the frame
   element for framed-panel. Everything else is a `data-inv-layout` selector, so
   adding a layout is a CSS change and a name in LAYOUTS, not a new branch. */

export function InvitationShell({ theme, lang = "en", children, className = "", preview = false }) {
  const t = sanitizeTheme(theme);
  // photo-hero puts the art in a band inside the card, so the fixed full-page
  // wash would double it up at two different opacities.
  const showPageArt = t.bgImage && t.layout !== "photo-hero";

  return (
    <div
      className={`inv-root ${className}`}
      style={themeVars(t)}
      dir={dirFor(lang)}
      lang={lang}
      data-inv-layout={t.layout}
      data-inv-motion={t.motion}
      data-inv-preview={preview ? "true" : undefined}
    >
      {showPageArt ? (
        <div className="inv-bgart" style={{ backgroundImage: `url(${t.bgImage})` }} aria-hidden />
      ) : null}
      {children}
    </div>
  );
}

/* `children` is the action row (add-to-calendar / directions). It is a slot
   rather than props because the guest page builds real links from the event
   while the studio shows inert stand-ins — but both land inside the same card,
   under the same layout rules, which is what the preview has to prove. */
export default function InvitationCard({ event, guest, theme, lang = "en", children }) {
  const th = sanitizeTheme(theme);
  const t = translate(lang);
  // The host's own paragraphs. Not translated — Karim writes them once, in the
  // language he means, and they appear as written on every guest's invitation.
  const body = bodyParagraphs(event.body_text);

  return (
    <article className="inv-card inv-rise">
      {/* framed-panel's inner rule. A real element rather than a ::before so it
          can sit above the hero image and below the ornament without a
          z-index fight in the stylesheet. */}
      {th.layout === "framed-panel" ? <span className="inv-frame" aria-hidden /> : null}

      {th.layout === "photo-hero" && th.bgImage ? (
        <div className="inv-hero" style={{ backgroundImage: `url(${th.bgImage})` }} aria-hidden />
      ) : null}

      <Ornament kind={th.ornament} />

      {/* Every value below is admin-entered free text that may be Latin, Malay
          or Arabic regardless of the page's own direction. <bdi> isolates each
          run so the browser resolves it on its own first strong character —
          without it, a Latin address beginning with a digit ("12 Woodlands
          Square") renders on an Arabic page as "Woodlands Square 12", which is
          simply the wrong address. */}
      <p className="inv-salam">
        {t("salam")}
        {guest?.name ? (
          <>
            {", "}
            <bdi>{String(guest.name).trim().split(/\s+/)[0]}</bdi>
          </>
        ) : null}
      </p>
      {/* A sentence, not a label: sentence case, serif, never letter-spaced. */}
      <p className="inv-invite-line">{t("inviteLine")}</p>
      <h1 className="inv-title">
        <bdi>{event.title}</bdi>
      </h1>
      {event.host_name ? (
        <p className="inv-host">
          {t("hostedBy")} <bdi>{event.host_name}</bdi>
        </p>
      ) : null}

      {body.length ? (
        <div className="inv-body">
          {body.map((para, i) => (
            // Positional key: these are paragraphs of one text, split on blank
            // lines — they have no identity beyond their order.
            <p key={i}>
              <bdi>{para}</bdi>
            </p>
          ))}
        </div>
      ) : null}

      <hr className="inv-rule" />

      {event.starts_at ? (
        <dl className="inv-detail">
          <dt>{t("when")}</dt>
          <dd>{formatEventDate(event.starts_at, lang)}</dd>
        </dl>
      ) : null}

      {event.venue_name || event.venue_address ? (
        <dl className="inv-detail">
          <dt>{t("where")}</dt>
          <dd>
            <bdi>{event.venue_name}</bdi>
            {event.venue_address ? (
              <>
                <br />
                <bdi className="inv-detail-sub">{event.venue_address}</bdi>
              </>
            ) : null}
          </dd>
        </dl>
      ) : null}

      {event.dress_code ? (
        <dl className="inv-detail">
          <dt>{t("dressCode")}</dt>
          <dd>
            <bdi>{event.dress_code}</bdi>
          </dd>
        </dl>
      ) : null}

      {children}

      <Ornament kind={th.ornament} className="inv-ornament-bottom" />
    </article>
  );
}
