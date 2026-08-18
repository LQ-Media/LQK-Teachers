"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  t as translate,
  fmt,
  formatDeadline,
  DECLINE_REASONS,
  partyLine,
} from "@/lib/events/i18n";
import {
  familyFields,
  attendeeFields,
  emptyAnswer,
  coerceAnswer,
  MAX_ATTENDEE_BLOCKS,
} from "@/lib/events/fields";
import { downscale, MAX_PICK_BYTES } from "@/lib/events/downscale";
import GuestField from "@/components/events/GuestField";
import { submitRsvp, startContribution, uploadFamilyPhoto, uploadFieldFile } from "./actions";

/* The reply block.

   One client component rather than several so the "attending" choice can drive
   what the rest of the form shows without prop-drilling or a store — declining
   guests should never be asked how many children they're bringing, and only
   attending guests ever see the contribution.

   THE CONTRIBUTION FLOW (when the event carries a store product):
   "Contribute & continue" saves the whole reply server-side FIRST (status
   'pending'), then opens the store checkout in a new tab. The reply is never
   held hostage by a checkout tab that might not come back. While pending, this
   component polls its own status endpoint; the orders/paid webhook flips the
   row and the poll paints the green strip without a reload. "Send my reply"
   only completes once the server has seen the payment.

   Photos are downscaled IN THE BROWSER before upload — see lib/events/downscale.

   CUSTOM QUESTIONS (lib/events/fields.js) come in two scopes: asked once of the
   family, or repeated for every head in the party. The per-person blocks are
   driven by the steppers above them, so changing the headcount adds or removes
   blocks live — and answers already typed into the remaining blocks survive,
   because the array is only ever grown or trimmed at the end. */

/* Past this cap the steppers stop being usable — nobody taps + ninety times —
   so a party-size-1000 event gets typed number inputs instead. */
const STEPPER_CAP = 20;

function Stepper({ label, value, onChange, min = 0, max = 20, minusLabel, plusLabel }) {
  return (
    <div className="inv-stepper">
      <span className="inv-stepper-label">{label}</span>
      <div className="inv-stepper-controls">
        <button
          type="button"
          className="inv-step-btn"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={minusLabel}
        >
          −
        </button>
        {/* aria-live so a screen reader announces the new count on change —
            otherwise pressing + is silent and the value is invisible. */}
        <span className="inv-step-value" aria-live="polite">
          {value}
        </span>
        <button
          type="button"
          className="inv-step-btn"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={plusLabel}
        >
          +
        </button>
      </div>
    </div>
  );
}

/* The typed counterpart to Stepper, for events that invite hundreds. */
function CountInput({ label, value, onChange, max }) {
  return (
    <div className="inv-stepper">
      <span className="inv-stepper-label">{label}</span>
      <input
        type="number"
        className="inv-count-input"
        min={0}
        max={max}
        inputMode="numeric"
        value={value}
        aria-label={label}
        onChange={(e) => {
          const n = Math.round(Number(e.target.value.replace(/[^\d]/g, "")));
          onChange(Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0);
        }}
      />
    </div>
  );
}

/* The product card + CTA / pending note / paid strip. Mutually exclusive
   states — the reference stacks them only so both are visible at once.

   LQK's contribution products are TIERED — the Maulid product carries $30, $50,
   $100 and $300 variants — so the card is driven by the tier the family chose,
   not by the product's headline price. The chooser appears only while there is
   still a choice to make: an event whose product link pins a variant is a fixed
   amount (product.pinned), and once a checkout is pending or paid the tier is
   already decided. */
function ContributionBlock({
  t,
  product,
  status,
  paidLine,
  busy,
  onContribute,
  checkoutUrl,
  onRecheck,
  rechecking,
  variantId,
  onVariantChange,
}) {
  const variants = product?.variants?.length ? product.variants : null;
  const selected = variants?.find((v) => v.id === variantId) || variants?.[0] || null;
  const canChoose = !!variants && variants.length > 1 && !product.pinned && status !== "paid" && status !== "pending";

  // A single-variant product has no tier name of its own — shape() falls its
  // title back to the product's, and printing "X — X" reads as a bug.
  const tier = selected && selected.title !== product?.title ? selected.title : null;

  return (
    <div className="inv-contrib">
      <div className="inv-contrib-head">
        <span className="inv-contrib-title">{t("contribTitle")}</span>
        <span className="inv-contrib-req">{t("contribRequired")}</span>
      </div>
      <p className="inv-contrib-body">{t("contribBody")}</p>

      {canChoose ? (
        /* Tier ROWS, not a <select>. The names come from the store and run long
           ("$100 — Supporter Set A (Green Dome Flatlay A4 Frame)"); inside a
           269px select on a phone that is clipped to nonsense, and on the
           Arabic invitation it is the PRICE end that gets cut. A row wraps.

           Same visually-hidden-radio pattern as the yes/no choices above, so
           it is the real radio that keyboards and screen readers operate. */
        <fieldset className="inv-tiers">
          <legend className="inv-tiers-legend">{t("contribChoose")}</legend>
          {variants.map((v) => (
            <label key={v.id} className="inv-tier">
              <input
                type="radio"
                name="contrib-variant"
                value={v.id}
                checked={selected?.id === v.id}
                disabled={busy || !v.available}
                onChange={() => onVariantChange(v.id)}
              />
              <span>
                {/* The mark, not colour alone, is what says "chosen". */}
                <span className="inv-choice-dot" aria-hidden>
                  {selected?.id === v.id ? "✓" : ""}
                </span>
                <span className="inv-tier-body">
                  <bdi className="inv-tier-name">{v.title}</bdi>
                  <span className="inv-tier-price">{v.priceText}</span>
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {product ? (
        <div className="inv-product">
          {selected?.image || product.image ? (
            /* Plain <img>: a 52px thumbnail from the store CDN doesn't earn a
               remotePatterns entry in next.config. eslint knows better: */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={selected?.image || product.image} alt="" className="inv-product-img" />
          ) : (
            <span className="inv-product-img" aria-hidden />
          )}
          <div className="inv-product-info">
            {/* ONE bdi around the whole line, not one per part: two adjacent
                isolates are laid out right-to-left on the Arabic invitation, so
                the tier printed before the product it belongs to. */}
            <span className="inv-product-title">
              <bdi>{tier ? `${product.title} — ${tier}` : product.title}</bdi>
            </span>
            <span className="inv-product-price">
              {selected?.priceText || product.priceText} · Little Quran Kids store
            </span>
          </div>
        </div>
      ) : null}

      {status === "paid" ? (
        <div className="inv-paid">
          <span className="inv-paid-check" aria-hidden>
            ✓
          </span>
          <span>{paidLine}</span>
        </div>
      ) : status === "pending" ? (
        /* The checkout is out there somewhere. The reply itself is ALREADY
           saved — say so, because a guest who thinks nothing was recorded will
           either give up or reply twice. */
        <>
          <p className="inv-contrib-pending">{t("contribPendingNote")}</p>
          {checkoutUrl ? (
            <a
              className="inv-btn inv-btn-contrib"
              href={checkoutUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {`${t("contribOpenCheckout")} ↗`}
            </a>
          ) : null}
          <button
            type="button"
            className="inv-btn inv-btn-quiet inv-contrib-recheck"
            disabled={rechecking}
            onClick={onRecheck}
          >
            {rechecking ? t("contribChecking") : t("contribRecheck")}
          </button>
          <p className="inv-contrib-small">{t("contribPendingSmall")}</p>
        </>
      ) : (
        <>
          <button type="button" className="inv-btn inv-btn-contrib" disabled={busy} onClick={onContribute}>
            {busy ? t("saving") : `${t("contribCta")} ↗`}
          </button>
          <p className="inv-contrib-small">{t("contribSmall")}</p>
        </>
      )}
    </div>
  );
}

export default function RsvpForm({
  token,
  lang,
  event,
  guest,
  rsvp,
  contribution, // product from the store, or null when the event has none
  calUrl,
  mapUrl,
}) {
  const t = translate(lang);
  const router = useRouter();
  const fileRef = useRef(null);

  // Legacy 'maybe' replies read as "not answered yet" — the option no longer
  // exists, and pre-filling either remaining choice would put words in the
  // family's mouth.
  const savedAttending = rsvp?.attending === "yes" || rsvp?.attending === "no" ? rsvp.attending : "";

  const [attending, setAttending] = useState(savedAttending);
  const [adults, setAdults] = useState(rsvp?.adults || 1);
  const [children, setChildren] = useState(rsvp?.children ?? 0);
  const [extraNames, setExtraNames] = useState(rsvp?.extra_names || "");
  const [declineReason, setDeclineReason] = useState(rsvp?.decline_reason || "");
  const [declineReasonNote, setDeclineReasonNote] = useState(rsvp?.decline_reason_note || "");
  const [message, setMessage] = useState(rsvp?.message || "");
  const [familyName, setFamilyName] = useState(guest.family_name || "");
  const [photoConsent, setPhotoConsent] = useState(!!rsvp?.photo_consent);
  const [preview, setPreview] = useState(null);
  const [photoState, setPhotoState] = useState(rsvp?.photo_drive_id ? "done" : "idle");
  const [photoDriveId, setPhotoDriveId] = useState(rsvp?.photo_drive_id || "");

  const [contributionStatus, setContributionStatus] = useState(rsvp?.contribution_status || "none");
  const [contributionTitle, setContributionTitle] = useState(rsvp?.contribution_title || "");
  const [contributionQty, setContributionQty] = useState(rsvp?.contribution_qty || 1);
  const [contributionPaidAt, setContributionPaidAt] = useState(rsvp?.contribution_paid_at || null);
  /* Which tier of a tiered contribution product the family is buying. A tier
     already sent to checkout wins over the product default, so coming back to
     this page — the normal way a family returns from the store — still shows
     the amount they actually chose. */
  const [variantId, setVariantId] = useState(
    rsvp?.contribution_variant_id || contribution?.variantId || ""
  );

  const [customAnswers, setCustomAnswers] = useState(() => rsvp?.custom || {});
  const [attendeeAnswers, setAttendeeAnswers] = useState(() =>
    Array.isArray(rsvp?.attendees) ? rsvp.attendees : []
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [checkoutUrl, setCheckoutUrl] = useState(null);
  const [rechecking, setRechecking] = useState(false);
  const [done, setDone] = useState(!!savedAttending);
  const [editing, setEditing] = useState(!savedAttending);
  const errorRef = useRef(null);

  const cap = event.max_party_size || 10;
  const needsContribution = !!event.ask_contribution && !!contribution;

  const perPerson = attendeeFields(event.customFields);
  const shownFamilyFields = familyFields(event.customFields, attending || "no");
  const headCount = attending === "yes" ? adults + children : 0;
  /* An event that invites three hundred gets the built-in party-names box, not
     three hundred repeated blocks. The cap is enforced identically on the
     server, so what is asked and what is validated can't drift. */
  const blocks = perPerson.length ? Math.min(headCount, MAX_ATTENDEE_BLOCKS) : 0;

  /* An error the guest can't see is an error that didn't happen. This form is
     long — the contribution button sits well above the fields it can fail on —
     so every rejection scrolls itself into view. */
  function showError(message) {
    setError(message);
    requestAnimationFrame(() => {
      errorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  function setCustom(id, value) {
    setCustomAnswers((a) => ({ ...a, [id]: value }));
    setError("");
  }

  function setAttendee(index, id, value) {
    setAttendeeAnswers((list) => {
      const next = [...list];
      while (next.length <= index) next.push({});
      next[index] = { ...next[index], [id]: value };
      return next;
    });
    setError("");
  }

  function answerFor(index, field) {
    const stored = attendeeAnswers[index]?.[field.id];
    return stored === undefined ? emptyAnswer(field) : stored;
  }

  /* While a checkout is out there, poll our own row. The webhook does the real
     work; this only repaints. Also refreshes when the tab regains focus —
     which is exactly the moment the guest comes back from the store. */
  /* One place that asks "has the store confirmed yet?", used by the 5s poll,
     by the tab-focus check, and by the guest tapping "I've paid — check again".
     Returns true when it flipped, so the manual path can say something honest
     when it didn't. */
  const checkContribution = useCallback(async () => {
    try {
      const res = await fetch(`/api/i/${token}/contribution`, { cache: "no-store" });
      if (!res.ok) return false;
      const body = await res.json();
      if (body.status !== "paid") return false;
      setContributionStatus("paid");
      setContributionTitle(body.title || "");
      setContributionQty(body.qty || 1);
      setContributionPaidAt(body.paidAt || null);
      router.refresh();
      return true;
    } catch {
      /* transient network — the next tick tries again */
      return false;
    }
  }, [token, router]);

  useEffect(() => {
    if (contributionStatus !== "pending") return undefined;
    const interval = setInterval(checkContribution, 5000);
    const onVisible = () => {
      if (document.visibilityState === "visible") checkContribution();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [contributionStatus, checkContribution]);

  /* The manual re-check. The poll already runs, but a guest coming back from a
     checkout in another tab has no way to know that — a button they can press
     is worth more than a spinner they can't see. */
  async function onRecheck() {
    setRechecking(true);
    const flipped = await checkContribution();
    setRechecking(false);
    if (!flipped) showError(t("contribStillPending"));
  }

  function choose(value) {
    setAttending(value);
    setError("");
    // Exactly one branch may hold values — switching away clears the other's.
    if (value === "yes") {
      setDeclineReason("");
      setDeclineReasonNote("");
    } else {
      setPreview(null);
    }
  }

  function replyPayload() {
    return {
      attending,
      adults,
      children,
      extraNames,
      declineReason,
      declineReasonNote,
      message,
      photoConsent,
      // Already in Drive by now (uploaded on pick); this only records WHICH
      // file on the reply row.
      photoDriveId,
      custom: customAnswers,
      // Trimmed to the blocks actually shown: a family that said 4 people, then
      // 2, must not silently submit answers for two people who aren't coming.
      attendees: attendeeAnswers.slice(0, blocks),
    };
  }

  /* Mirrors the server's rules so a guest sees the problem before the round
     trip. The server is still the authority — this is courtesy, not a gate. */
  function validateLocally() {
    if (!attending) return "required";
    if (attending === "no" && !declineReason) return "reasonRequired";
    if (attending === "no" && declineReason === "other" && !declineReasonNote.trim())
      return "reasonRequired";
    if (attending === "yes" && adults + children < 1) return "required";
    if (attending === "yes" && adults + children > cap) return "partyTooBig";

    for (const f of shownFamilyFields) {
      const result = coerceAnswer(f, customAnswers[f.id]);
      if (result.error) return result.error;
    }
    for (let i = 0; i < blocks; i += 1) {
      for (const f of perPerson) {
        const result = coerceAnswer(f, attendeeAnswers[i]?.[f.id]);
        if (result.error) return result.error;
      }
    }
    return null;
  }

  /* The family photo goes to Drive ON PICK, on its own round trip — exactly
     like a custom "file" answer, and for the same reason: Drive and the reply
     must never be able to cost each other.

     It used to ride along at the end of onSubmit, which meant that on any event
     asking for a contribution the photo could not go up at all. "Contribute &
     continue" saved the reply and never touched the photo; "Send my reply"
     bailed out at the contribIncomplete guard above the upload; and a family
     returning from checkout on a fresh page load no longer had the preview in
     memory to send. Nothing reached the Drive folder. */
  async function onPickPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    if (file.size > MAX_PICK_BYTES) {
      setError(t("tooLarge"));
      return;
    }

    let dataUrl;
    try {
      setPhotoState("working");
      dataUrl = await downscale(file);
      setPreview(dataUrl);
    } catch {
      setPhotoState("idle");
      setError(t("error"));
      return;
    }

    const up = await uploadFamilyPhoto(token, { dataUrl, familyName });
    if (!up.ok) {
      setPhotoState("failed");
      showError(t(up.error) || t("uploadFailed"));
      return;
    }
    setPhotoDriveId(up.fileId || "");
    setPhotoState("done");
  }

  /* Custom "photo upload" answers go up the moment they're picked, on their own
     round trip — same reasoning as the family photo: Drive must never be able
     to cost a family their reply. The answer stored in the field is the Drive
     file id the server hands back, never anything the guest chose. */
  async function onFieldUpload({ fieldId, dataUrl }) {
    return uploadFieldFile(token, { fieldId, dataUrl });
  }

  /* "Contribute & continue".

     The client validates EXACTLY what startContribution validates. It used to
     skip validation whenever attending === "yes" — which is every time this
     button is reachable — so a required custom question left blank failed on
     the server, the pre-opened tab was closed again, and the only sign was an
     error message rendered near the submit button far below the fold. From the
     guest's seat the button simply did nothing. */
  async function onContribute() {
    const invalid = validateLocally();
    if (invalid) {
      showError(t(invalid));
      return;
    }
    setSaving(true);
    setError("");

    // Safari blocks window.open after an await — claim the tab first, then
    // point it at the checkout once the server hands the URL back.
    const checkoutTab = typeof window !== "undefined" ? window.open("", "_blank") : null;

    const result = await startContribution(token, { ...replyPayload(), variantId });
    setSaving(false);

    if (!result.ok) {
      checkoutTab?.close();
      showError(t(result.error) || t("error"));
      return;
    }
    if (result.alreadyPaid) {
      checkoutTab?.close();
      setContributionStatus("paid");
      return;
    }

    setContributionStatus("pending");
    // The server has the last word on which variant this is (a tier that went
    // out of stock between render and click resolves to another one).
    if (result.variantId) setVariantId(result.variantId);
    /* Keep the URL either way. If the popup was blocked — the default on iOS
       Safari — we must NOT navigate this tab away: the store's thank-you page
       has no route back to the invitation, so the guest would be stranded mid
       reply with no way to finish. Showing a real anchor instead is the one
       thing no popup blocker stops. */
    setCheckoutUrl(result.checkoutUrl);
    if (checkoutTab) checkoutTab.location.replace(result.checkoutUrl);
  }

  async function onSubmit(e) {
    e.preventDefault();
    const invalid = validateLocally();
    if (invalid) {
      setError(t(invalid));
      return;
    }
    if (attending === "yes" && needsContribution && contributionStatus !== "paid") {
      setError(t("contribIncomplete"));
      return;
    }
    setSaving(true);
    setError("");

    const result = await submitRsvp(token, replyPayload());

    if (!result.ok) {
      setSaving(false);
      setError(t(result.error) || t("error"));
      return;
    }

    // Nothing to do for the photo here: it went to Drive when it was picked,
    // and replyPayload carried its file id onto the row just now.
    setSaving(false);
    setDone(true);
    setEditing(false);
  }

  /* ---- confirmation ------------------------------------------------------ */

  if (done && !editing) {
    const isYes = attending === "yes";
    const unpaid = isYes && needsContribution && contributionStatus !== "paid";
    return (
      <div className="inv-card inv-rise inv-rsvp-block inv-confirm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/dzikir/maulid.png" alt="" className="inv-confirm-art" />
        <h2 className="inv-confirm-title">{isYes ? t("thanksYes") : t("thanksNo")}</h2>

        <p className="inv-summary">
          {t("youReplied")} <strong>{isYes ? t("yes") : t("no")}</strong>
          {isYes && adults + children > 0 ? <> · {partyLine(lang, adults, children)}</> : null}
        </p>

        {isYes && contributionStatus === "paid" ? (
          <p className="inv-summary">
            {t("contribution")}:{" "}
            <strong>
              {contributionQty || 1} × <bdi>{contributionTitle || contribution?.title || ""}</bdi>
            </strong>
            {contributionPaidAt ? <>, {fmt(t("paidOn"), { date: formatDeadline(contributionPaidAt, lang) })}</> : null}
          </p>
        ) : null}

        {unpaid ? (
          <>
            <p className="inv-error">{t("contribIncomplete")}</p>
            <ContributionBlock
              t={t}
              product={contribution}
              status={contributionStatus}
              busy={saving}
              onContribute={onContribute}
              checkoutUrl={checkoutUrl}
              onRecheck={onRecheck}
              rechecking={rechecking}
              variantId={variantId}
              onVariantChange={setVariantId}
            />
          </>
        ) : null}

        {photoState === "failed" ? <p className="inv-error">{t("photoFailed")}</p> : null}

        {/* The calendar and directions pills again — a family that just said
            yes shouldn't have to scroll back up to find them. */}
        {isYes && (calUrl || mapUrl) ? (
          <div className="inv-actions">
            {calUrl ? (
              <a className="inv-btn inv-btn-quiet" href={calUrl}>
                {t("addToCalendar")}
              </a>
            ) : null}
            {mapUrl ? (
              <a className="inv-btn inv-btn-quiet" href={mapUrl} target="_blank" rel="noopener noreferrer">
                {t("getDirections")}
              </a>
            ) : null}
          </div>
        ) : null}

        <div className="inv-actions">
          <button type="button" className="inv-btn-link" onClick={() => setEditing(true)}>
            {t("changeReply")}
          </button>
        </div>
      </div>
    );
  }

  /* ---- the form ---------------------------------------------------------- */

  const paidLine = fmt(t("contribPaidLine"), {
    qty: contributionQty || 1,
    title: contributionTitle || contribution?.title || "",
  });

  return (
    <form className="inv-card inv-rise inv-rsvp-block" onSubmit={onSubmit} noValidate>
      <h2 className="inv-section-title">{t("rsvpTitle")}</h2>
      <p className="inv-note">
        {event.rsvp_deadline
          ? `${fmt(t("replyBy"), { date: formatDeadline(event.rsvp_deadline, lang) })} `
          : ""}
        {fmt(t("partyCap"), { n: cap })}
      </p>

      <fieldset className="inv-choices" style={{ border: 0, padding: 0, margin: "0 0 20px" }}>
        <legend className="sr-only">{t("rsvpTitle")}</legend>
        {[
          ["yes", t("yes")],
          ["no", t("no")],
        ].map(([value, label]) => (
          <label key={value} className="inv-choice">
            <input
              type="radio"
              name="attending"
              value={value}
              checked={attending === value}
              onChange={() => choose(value)}
            />
            <span>
              {/* The mark, not colour alone, is what says "chosen". */}
              <span className="inv-choice-dot" aria-hidden>
                {attending === value ? "✓" : ""}
              </span>
              {label}
            </span>
          </label>
        ))}
      </fieldset>

      {attending === "no" ? (
        <div className="inv-why">
          <p className="inv-why-title">{t("whyTitle")}</p>
          <p className="inv-why-hint">{t("whyHint")}</p>
          <select
            className="inv-select"
            value={declineReason}
            onChange={(e) => {
              setDeclineReason(e.target.value);
              setError("");
            }}
            aria-label={t("whyTitle")}
          >
            <option value="" disabled>
              {t("chooseReason")}
            </option>
            {DECLINE_REASONS.map((key) => (
              <option key={key} value={key}>
                {t(`reason_${key}`)}
              </option>
            ))}
          </select>
          {declineReason === "other" ? (
            <input
              className="inv-input"
              style={{ marginTop: 10 }}
              value={declineReasonNote}
              onChange={(e) => setDeclineReasonNote(e.target.value)}
              placeholder={t("reasonOtherLabel")}
              aria-label={t("reasonOtherLabel")}
            />
          ) : null}
        </div>
      ) : null}

      {attending === "yes" ? (
        <>
          <div className="inv-steppers">
            {cap > STEPPER_CAP ? (
              <>
                <CountInput
                  label={t("adults")}
                  value={adults}
                  onChange={setAdults}
                  max={Math.max(0, cap - children)}
                />
                <CountInput
                  label={t("children")}
                  value={children}
                  onChange={setChildren}
                  max={Math.max(0, cap - adults)}
                />
              </>
            ) : (
              <>
                <Stepper
                  label={t("adults")}
                  value={adults}
                  onChange={setAdults}
                  max={Math.max(0, cap - children)}
                  minusLabel={t("fewerAdult")}
                  plusLabel={t("moreAdult")}
                />
                <Stepper
                  label={t("children")}
                  value={children}
                  onChange={setChildren}
                  max={Math.max(0, cap - adults)}
                  minusLabel={t("fewerChild")}
                  plusLabel={t("moreChild")}
                />
              </>
            )}
          </div>

          {needsContribution ? (
            <ContributionBlock
              t={t}
              product={contribution}
              status={contributionStatus}
              paidLine={paidLine}
              busy={saving}
              onContribute={onContribute}
              checkoutUrl={checkoutUrl}
              onRecheck={onRecheck}
              rechecking={rechecking}
              variantId={variantId}
              onVariantChange={setVariantId}
            />
          ) : null}

          {blocks ? (
            <div className="inv-people">
              <h3 className="inv-section-title inv-people-title">{t("aboutEveryone")}</h3>
              {Array.from({ length: blocks }, (_, i) => (
                /* Index keys are right here: a block IS its position in the
                   party, and reordering isn't a thing a party can do. */
                <div key={i} className="inv-person">
                  <p className="inv-person-label">
                    {i < adults
                      ? fmt(t("personAdult"), { n: i + 1 })
                      : fmt(t("personChild"), { n: i - adults + 1 })}
                  </p>
                  {perPerson.map((f) => (
                    <GuestField
                      key={f.id}
                      field={f}
                      value={answerFor(i, f)}
                      onChange={(v) => setAttendee(i, f.id, v)}
                      t={t}
                      disabled={saving}
                      onUpload={onFieldUpload}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : null}

          {/* The free-text list only earns its place when nobody is being asked
              for names person by person — otherwise it asks for the same thing
              twice, in a worse format. */}
          {!blocks ? (
            <div className="inv-field">
              <label className="inv-label" htmlFor="extraNames">
                {t("partyNames")}
                <span className="inv-hint">{t("partyNamesHint")}</span>
              </label>
              <textarea
                id="extraNames"
                className="inv-textarea"
                value={extraNames}
                onChange={(e) => setExtraNames(e.target.value)}
              />
            </div>
          ) : null}

          {event.ask_photo ? (
            <div className="inv-field">
              <h3 className="inv-label" style={{ fontSize: 15 }}>
                {t("photoTitle")}
                <span className="inv-hint">{t("photoHint")}</span>
              </h3>

              {/* Asked BEFORE the picker, because the upload now happens the
                  moment a photo is chosen and this name is what the file is
                  called in Drive — Karim's downstream batch reads the family
                  off the filename. Pre-filled from the guest record, so for
                  most families it is already right and needs no thought. */}
              <div className="inv-field" style={{ marginBottom: 12 }}>
                <label className="inv-label" htmlFor="familyName">
                  {t("familyName")}
                  <span className="inv-hint">{t("familyNameHint")}</span>
                </label>
                <input
                  id="familyName"
                  className="inv-input"
                  value={familyName}
                  onChange={(e) => setFamilyName(e.target.value)}
                />
              </div>

              {preview ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={preview} alt="" className="inv-photo-preview" />
              ) : null}

              <div
                className="inv-photo-drop"
                role="button"
                tabIndex={0}
                onClick={() => fileRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileRef.current?.click();
                  }
                }}
              >
                {photoState === "working"
                  ? t("uploading")
                  : photoState === "done"
                    ? `✓ ${t("uploaded")} — ${t("changePhoto")}`
                    : photoState === "failed"
                      ? t("changePhoto")
                      : t("choosePhoto")}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={onPickPhoto}
              />

              {preview ? (
                <label className="inv-check" style={{ marginTop: 14 }}>
                  <input
                    type="checkbox"
                    checked={photoConsent}
                    onChange={(e) => setPhotoConsent(e.target.checked)}
                  />
                  <span>{t("photoConsent")}</span>
                </label>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      {attending && shownFamilyFields.length ? (
        <div className="inv-extra">
          <h3 className="inv-section-title inv-people-title">{t("aboutYou")}</h3>
          {shownFamilyFields.map((f) => (
            <GuestField
              key={f.id}
              field={f}
              value={customAnswers[f.id] === undefined ? emptyAnswer(f) : customAnswers[f.id]}
              onChange={(v) => setCustom(f.id, v)}
              t={t}
              disabled={saving}
              onUpload={onFieldUpload}
            />
          ))}
        </div>
      ) : null}

      {attending ? (
        <div className="inv-field">
          <label className="inv-label" htmlFor="message">
            {t("message")}
          </label>
          <textarea
            id="message"
            className="inv-textarea"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>
      ) : null}

      <p ref={errorRef} className="inv-error" role="alert" hidden={!error}>
        {error}
      </p>

      <button type="submit" className="inv-btn" disabled={saving}>
        {saving ? t("saving") : savedAttending ? t("update") : t("submit")}
      </button>
    </form>
  );
}
